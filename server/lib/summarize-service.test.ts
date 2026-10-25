import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, readFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { SummarizeService, SummarizeError, SummarizeParseError, SummarizeConfigError } from './summarize-service.js';
import { StorageError } from './errors.js';
import type { AnthropicClient, SummarizeOptions } from './ai-client.js';
import { FileStore } from './file-store.js';
import { CacheDb } from './cache-db.js';
import { createRecentWrites } from './recent-writes.js';
import { InteractionSchema, INTERACTION_SCHEMA_VERSION, type Interaction } from '../schemas/interaction.js';
import type { Logger } from './logger.js';

// ---------------------------------------------------------------------------
// MockAnthropicClient — implements the updated interface (returns string)
// ---------------------------------------------------------------------------
function createMockClient(
  respondWith: (() => Promise<string>) | (() => never)
): AnthropicClient & { calls: { rawText: string; options?: SummarizeOptions }[] } {
  const calls: { rawText: string; options?: SummarizeOptions }[] = [];
  return {
    isConfigured: true,
    calls,
    async summarize(rawText: string, options?: SummarizeOptions) {
      calls.push({ rawText, options });
      return respondWith();
    },
  };
}

function createMockLogger(): Logger {
  return { debug() {}, info() {}, warn() {}, error() {} };
}

function makeInteraction(overrides: Partial<Interaction> = {}): Interaction {
  return InteractionSchema.parse({
    id:            crypto.randomUUID(),
    createdAt:     '2026-06-01T00:00:00.000Z',
    updatedAt:     '2026-06-01T00:00:00.000Z',
    deletedAt:     null,
    schemaVersion: INTERACTION_SCHEMA_VERSION,
    contactId:     crypto.randomUUID(),
    occurredAt:    '2026-06-01T10:00:00.000Z',
    type:          'meeting',
    summary:       'uh so we talked and she mentioned the project and stuff',
    location:      null,
    ...overrides,
  });
}

const VALID_RESULT = { summary: 'Discussed the project.', followUps: ['Follow up on timeline'] };
const VALID_JSON = JSON.stringify(VALID_RESULT);

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------
describe('SummarizeService', () => {
  let tempDir: string;
  let interactionsDir: string;
  let cacheDb: CacheDb;
  let interactionsStore: FileStore<Interaction>;

  beforeEach(async () => {
    tempDir = await mkdtemp(path.join(tmpdir(), 'crm-summarize-test-'));
    interactionsDir = path.join(tempDir, 'interactions');
    await mkdir(interactionsDir, { recursive: true });
    await mkdir(path.join(tempDir, '.quarantine'), { recursive: true });

    cacheDb = new CacheDb(path.join(tempDir, 'cache.db'));
    cacheDb.init();

    interactionsStore = new FileStore<Interaction>(
      interactionsDir,
      InteractionSchema,
      { cacheDb, logger: createMockLogger(), recentWrites: createRecentWrites() },
      { expectedSchemaVersion: INTERACTION_SCHEMA_VERSION }
    );
  });

  afterEach(async () => {
    cacheDb.close();
    await rm(tempDir, { recursive: true, force: true });
  });

  // ---------------------------------------------------------------------------
  // 1. Request shape — rawText === interaction.summary verbatim on both calls
  // ---------------------------------------------------------------------------
  it('passes interaction.summary as rawText on both first and retry call', async () => {
    const mockClient: AnthropicClient & { calls: { rawText: string; options?: SummarizeOptions }[] } = {
      isConfigured: true,
      calls: [],
      async summarize(rawText: string, options?: SummarizeOptions) {
        this.calls.push({ rawText, options });
        // First call returns wrong-shape JSON so retry fires
        if (this.calls.length === 1) {
          return JSON.stringify({ summary: '', followUps: [] }); // fails .min(1)
        }
        return VALID_JSON;
      },
    };

    const interaction = makeInteraction({ summary: 'verbatim note text' });
    await interactionsStore.save(interaction, { preserveTimestamps: true });
    const service = new SummarizeService(mockClient, interactionsStore);
    await service.summarize(interaction);

    expect(mockClient.calls).toHaveLength(2);
    expect(mockClient.calls[0]?.rawText).toBe('verbatim note text');
    expect(mockClient.calls[1]?.rawText).toBe('verbatim note text');
    expect(mockClient.calls[0]?.options?.nudge).toBeFalsy();
    expect(mockClient.calls[1]?.options?.nudge).toBe(true);
  });

  // ---------------------------------------------------------------------------
  // 2. Success path — persists aiSummary + followUps to disk
  // ---------------------------------------------------------------------------
  it('success: persists aiSummary and followUps and returns updated interaction', async () => {
    const client = createMockClient(() => Promise.resolve(VALID_JSON));
    const interaction = makeInteraction();
    await interactionsStore.save(interaction, { preserveTimestamps: true });
    const service = new SummarizeService(client, interactionsStore);

    const result = await service.summarize(interaction);

    expect(result.aiSummary).toBe(VALID_RESULT.summary);
    expect(result.followUps).toEqual(VALID_RESULT.followUps);

    const onDisk = JSON.parse(
      await readFile(path.join(interactionsDir, `${interaction.id}.json`), 'utf-8')
    ) as { aiSummary: string; followUps: string[] };
    expect(onDisk.aiSummary).toBe(VALID_RESULT.summary);
    expect(onDisk.followUps).toEqual(VALID_RESULT.followUps);
  });

  // ---------------------------------------------------------------------------
  // 3. Wrong-shape JSON first / valid second — retries with nudge:true
  // ---------------------------------------------------------------------------
  it('wrong-shape JSON first response triggers retry; succeeds on valid second', async () => {
    const mockClient: AnthropicClient & { calls: { rawText: string; options?: SummarizeOptions }[] } = {
      isConfigured: true,
      calls: [],
      async summarize(rawText: string, options?: SummarizeOptions) {
        this.calls.push({ rawText, options });
        if (this.calls.length === 1) {
          return JSON.stringify({ summary: '', followUps: [] }); // valid JSON, fails .min(1)
        }
        return VALID_JSON;
      },
    };

    const interaction = makeInteraction();
    await interactionsStore.save(interaction, { preserveTimestamps: true });
    const service = new SummarizeService(mockClient, interactionsStore);
    const result = await service.summarize(interaction);

    expect(mockClient.calls).toHaveLength(2);
    expect(mockClient.calls[1]?.options?.nudge).toBe(true);
    expect(result.aiSummary).toBe(VALID_RESULT.summary);
  });

  // ---------------------------------------------------------------------------
  // 4. Non-JSON first response — invalid JSON also triggers retry (the bug fix)
  // This is the case the nudge prompt was designed for: markdown-fenced output,
  // a preamble, or a response truncated at max_tokens all reach the retry path.
  // ---------------------------------------------------------------------------
  it('non-JSON first response (markdown-fenced) triggers retry with nudge:true; succeeds on valid second', async () => {
    const mockClient: AnthropicClient & { calls: { rawText: string; options?: SummarizeOptions }[] } = {
      isConfigured: true,
      calls: [],
      async summarize(rawText: string, options?: SummarizeOptions) {
        this.calls.push({ rawText, options });
        if (this.calls.length === 1) {
          // Realistic bad output: markdown-fenced JSON — JSON.parse throws on ```
          return '```json\n{"summary":"Discussed the project.","followUps":[]}\n```';
        }
        return VALID_JSON;
      },
    };

    const interaction = makeInteraction();
    await interactionsStore.save(interaction, { preserveTimestamps: true });
    const service = new SummarizeService(mockClient, interactionsStore);
    const result = await service.summarize(interaction);

    expect(mockClient.calls).toHaveLength(2);
    expect(mockClient.calls[1]?.options?.nudge).toBe(true);  // nudge fired
    expect(result.aiSummary).toBe(VALID_RESULT.summary);     // succeeded on retry
  });

  // ---------------------------------------------------------------------------
  // 5. Malformed both responses (non-JSON first, wrong-shape second)
  // Proves the retry fires for invalid JSON AND that a second failure → SummarizeParseError
  // ---------------------------------------------------------------------------
  it('malformed both responses: throws SummarizeParseError; interaction on disk unchanged', async () => {
    const mockClient: AnthropicClient = {
      isConfigured: true,
      async summarize(_rawText: string, options?: SummarizeOptions) {
        if (!options?.nudge) {
          return 'Here is the summary: not valid JSON';   // non-JSON first response
        }
        return JSON.stringify({ summary: '', followUps: [] }); // wrong-shape retry
      },
    };

    const interaction = makeInteraction();
    await interactionsStore.save(interaction, { preserveTimestamps: true });
    const service = new SummarizeService(mockClient, interactionsStore);

    const err = await service.summarize(interaction).catch((e) => e);
    expect(err).toBeInstanceOf(SummarizeParseError);
    expect(err.recoverable).toBe(true);

    const onDisk = JSON.parse(
      await readFile(path.join(interactionsDir, `${interaction.id}.json`), 'utf-8')
    ) as { aiSummary: unknown; followUps: unknown };
    expect(onDisk.aiSummary == null).toBe(true);
    expect(onDisk.followUps == null).toBe(true);
  });

  // ---------------------------------------------------------------------------
  // 6. SDK transport error — wrapped as SummarizeError(recoverable:true); disk unchanged
  // Transport errors throw from inside client.summarize() before returning text,
  // so they hit the transport catch — NOT the parse retry path.
  // ---------------------------------------------------------------------------
  it('SDK error: wrapped as SummarizeError with recoverable:true; interaction unchanged', async () => {
    const mockClient: AnthropicClient = {
      isConfigured: true,
      async summarize() {
        throw new Error('rate_limit_error');
      },
    };

    const interaction = makeInteraction();
    await interactionsStore.save(interaction, { preserveTimestamps: true });
    const service = new SummarizeService(mockClient, interactionsStore);

    const err = await service.summarize(interaction).catch((e) => e);
    expect(err).toBeInstanceOf(SummarizeError);
    expect(err).not.toBeInstanceOf(SummarizeParseError);
    expect(err).not.toBeInstanceOf(SummarizeConfigError);
    expect(err.recoverable).toBe(true);

    const onDisk = JSON.parse(
      await readFile(path.join(interactionsDir, `${interaction.id}.json`), 'utf-8')
    ) as { aiSummary: unknown };
    expect(onDisk.aiSummary == null).toBe(true);
  });

  // ---------------------------------------------------------------------------
  // 7. Missing key — SummarizeConfigError(recoverable:false); no call made
  // ---------------------------------------------------------------------------
  it('missing key: throws SummarizeConfigError(recoverable:false) before any client call', async () => {
    const mockClient: AnthropicClient & { callCount: number } = {
      isConfigured: false,
      callCount: 0,
      async summarize() {
        this.callCount++;
        return VALID_JSON;
      },
    };

    const interaction = makeInteraction();
    const service = new SummarizeService(mockClient, interactionsStore);

    const err = await service.summarize(interaction).catch((e) => e);
    expect(err).toBeInstanceOf(SummarizeConfigError);
    expect(err.recoverable).toBe(false);
    expect(err.message).toContain('not configured');
    expect(mockClient.callCount).toBe(0);
  });

  // ---------------------------------------------------------------------------
  // 8. Persist StorageError reclassification — Failure-4 guarantee
  // ---------------------------------------------------------------------------
  it('StorageError from save() is reclassified as SummarizeError(recoverable:true); disk unchanged', async () => {
    const client = createMockClient(() => Promise.resolve(VALID_JSON));
    const interaction = makeInteraction();
    await interactionsStore.save(interaction, { preserveTimestamps: true });

    vi.spyOn(interactionsStore, 'save').mockRejectedValueOnce(
      new StorageError('disk full', { op: 'fileStore.save' })
    );

    const service = new SummarizeService(client, interactionsStore);
    const err = await service.summarize(interaction).catch((e) => e);

    expect(err).toBeInstanceOf(SummarizeError);
    expect(err).not.toBeInstanceOf(SummarizeConfigError);
    expect(err.recoverable).toBe(true);

    const onDisk = JSON.parse(
      await readFile(path.join(interactionsDir, `${interaction.id}.json`), 'utf-8')
    ) as { aiSummary: unknown };
    expect(onDisk.aiSummary == null).toBe(true);
  });
});
