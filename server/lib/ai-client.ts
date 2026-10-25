import Anthropic from '@anthropic-ai/sdk';

export interface SummarizeOptions {
  /** When true, prepends the parse-failure nudge to the system prompt. */
  nudge?: boolean;
}

/**
 * Injectable interface for AI summarization.
 * Production implementation uses the Anthropic SDK; tests substitute a mock.
 */
export interface AnthropicClient {
  /** False when the API key was absent at construction — checked before any call. */
  readonly isConfigured: boolean;
  /** Returns the raw response text — JSON parsing is the caller's responsibility. */
  summarize(rawText: string, options?: SummarizeOptions): Promise<string>;
}

const DEFAULT_MODEL = 'claude-haiku-4-5-20251001';
const REQUEST_TIMEOUT_MS = 30_000;
const MAX_TOKENS = 1024;

const BASE_SYSTEM_PROMPT =
  'You are a professional assistant that extracts information from meeting notes. ' +
  'Return ONLY a JSON object — no markdown fencing, no preamble, no explanation — ' +
  'with exactly two keys: "summary" (a concise 2-3 sentence string) and ' +
  '"followUps" (an array of short action-item strings, empty array if none). ' +
  'Example: {"summary":"...", "followUps":["..."]}';

const NUDGE_PREFIX =
  'Your previous response did not match the required shape. ' +
  'Return ONLY a JSON object with keys "summary" (string) and "followUps" ' +
  '(array of strings). No markdown, no preamble, no explanation.\n\n';

export class AnthropicSdkClient implements AnthropicClient {
  readonly isConfigured: boolean;
  private readonly sdk: Anthropic | null;
  private readonly model: string;

  constructor(apiKey: string | undefined, model: string = DEFAULT_MODEL) {
    this.isConfigured = Boolean(apiKey);
    this.model = model;
    // Do not throw at construction — app must start even without a key.
    this.sdk = apiKey ? new Anthropic({ apiKey, timeout: REQUEST_TIMEOUT_MS }) : null;
  }

  async summarize(rawText: string, options?: SummarizeOptions): Promise<string> {
    // Defensive guard — SummarizeService checks isConfigured before calling,
    // but this prevents accidental direct use from reaching the network.
    if (!this.sdk) {
      throw new Error('AI summarization is not configured: ANTHROPIC_API_KEY is not set');
    }

    const systemPrompt = options?.nudge
      ? NUDGE_PREFIX + BASE_SYSTEM_PROMPT
      : BASE_SYSTEM_PROMPT;

    const response = await this.sdk.messages.create({
      model:      this.model,
      max_tokens: MAX_TOKENS,
      system:     systemPrompt,
      messages:   [{ role: 'user', content: rawText }],
    });

    const block = response.content[0];
    if (!block || block.type !== 'text') {
      throw new Error('Unexpected response structure from Anthropic API');
    }

    // Return raw text — JSON parsing and schema validation are SummarizeService's
    // responsibility so that invalid JSON triggers the parse-retry path.
    return block.text;
  }
}
