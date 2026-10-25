import { z } from 'zod';
import { StorageError, ValidationError } from './errors.js';
import type { AnthropicClient } from './ai-client.js';
import type { FileStore } from './file-store.js';
import type { Interaction } from '../schemas/interaction.js';
import { AppError, type AppErrorOptions } from './errors.js';

// ---------------------------------------------------------------------------
// Error classes
// ---------------------------------------------------------------------------

/** Transient AI call failure — recoverable, client should show Retry. */
export class SummarizeError extends AppError {
  override readonly recoverable = true as const;
  constructor(message: string, options: Omit<AppErrorOptions, 'recoverable'>) {
    super(message, { ...options, recoverable: true });
  }
}

/** Parse failure after one retry — still transient, recoverable. */
export class SummarizeParseError extends SummarizeError {}

/** Missing API key — configuration failure, NOT recoverable; no Retry affordance. */
export class SummarizeConfigError extends AppError {
  override readonly recoverable = false as const;
  constructor(message: string, options: Omit<AppErrorOptions, 'recoverable'>) {
    super(message, { ...options, recoverable: false });
  }
}

// ---------------------------------------------------------------------------
// Response schema — at least as strict as storage caps (ADR must-fix-2)
// ---------------------------------------------------------------------------
const SummarizeResponseSchema = z.object({
  summary:   z.string().min(1).max(5000),
  followUps: z.array(z.string().max(500)).max(20),
});

type ParsedResponse = z.infer<typeof SummarizeResponseSchema>;

// Attempt JSON.parse + Zod validation. Returns null on ANY failure so both
// invalid-JSON (markdown fence, preamble, truncated) and wrong-shape responses
// route through the same retry path.
function tryParse(text: string): ParsedResponse | null {
  try {
    const obj: unknown = JSON.parse(text);
    const result = SummarizeResponseSchema.safeParse(obj);
    return result.success ? result.data : null;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// SummarizeService
// ---------------------------------------------------------------------------

export class SummarizeService {
  constructor(
    private readonly client: AnthropicClient,
    private readonly interactionsStore: FileStore<Interaction>
  ) {}

  async summarize(interaction: Interaction): Promise<Interaction> {
    // Config guard — checked before any call; throws non-recoverable error
    if (!this.client.isConfigured) {
      throw new SummarizeConfigError(
        'AI summarization is not configured: ANTHROPIC_API_KEY is not set',
        { op: 'summarizeService.summarize' }
      );
    }

    // Empty-summary is a caller error — route validates before reaching here;
    // this guard is defensive only.
    const rawText = interaction.summary ?? '';
    if (!rawText.trim()) {
      throw new ValidationError('Interaction has no summary text to summarize', {
        op: 'summarizeService.summarize',
        context: { interactionId: interaction.id },
      });
    }

    // --- First call — transport errors caught here; parse happens OUTSIDE this try ---
    let firstText: string;
    try {
      firstText = await this.client.summarize(rawText);
    } catch (err) {
      // SDK transport error (rate limit, timeout, overload, auth).
      // Use err.name not err.message — err.message may contain the API key
      // if the SDK embeds it in auth-failure error text, and SummarizeError.message
      // ends up in toDebugBlock() which is copy-pasteable per ADR 010.
      throw new SummarizeError(
        `AI call failed: ${(err as Error).name ?? 'Error'}`,
        { op: 'summarizeService.call', cause: err instanceof Error ? err : undefined }
      );
    }

    // Parse outside the transport catch — invalid JSON and wrong-shape both yield
    // null and trigger the retry, which is the fix for the markdown-fence bug.
    let parsed: ParsedResponse | null = tryParse(firstText);

    // --- One parse-retry on any malformed first response ---
    if (parsed === null) {
      let retryText: string;
      try {
        retryText = await this.client.summarize(rawText, { nudge: true });
      } catch (err) {
        throw new SummarizeError(
          `AI retry call failed: ${(err as Error).name ?? 'Error'}`,
          { op: 'summarizeService.retry', cause: err instanceof Error ? err : undefined }
        );
      }

      parsed = tryParse(retryText);

      if (parsed === null) {
        throw new SummarizeParseError(
          'AI response did not match the required shape after retry',
          { op: 'summarizeService.parse' }
        );
      }
    }

    // --- Persist to disk ---
    const updated: Interaction = {
      ...interaction,
      aiSummary: parsed.summary,
      followUps: parsed.followUps,
    };

    try {
      await this.interactionsStore.save(updated);
    } catch (err) {
      // Bad disk, not bad data. Original file intact (atomic write).
      // Reclassify StorageError as transient so the route surfaces
      // recoverable:true and the client shows Retry (Failure-4 philosophy).
      if (err instanceof StorageError) {
        throw new SummarizeError(
          `AI summary could not be saved: ${err.message}`,
          { op: 'summarizeService.persist', cause: err }
        );
      }
      throw err; // unexpected bug — propagate as loud 500
    }

    return updated;
  }
}
