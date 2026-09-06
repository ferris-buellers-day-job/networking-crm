import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, writeFile, readFile, mkdir, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { z } from 'zod';
import { FileStore, FileStoreQuarantineError } from './file-store.js';
import type { MigrationFn } from './file-store.js';
import { StorageError } from './errors.js';
import { CacheDb } from './cache-db.js';
import { createRecentWrites } from './recent-writes.js';
import { BaseRecordSchema } from './schemas/base-record.js';
import { atomicWriteJson } from './atomic-writer.js';
import type { Logger } from './logger.js';
// Production schema version constants — scope boundary test asserts each === 1
import { CONTACT_SCHEMA_VERSION } from '../schemas/contact.js';
import { INTERACTION_SCHEMA_VERSION } from '../schemas/interaction.js';
import { INBOX_ENTRY_SCHEMA_VERSION } from '../schemas/inbox-entry.js';
import { REMINDER_SCHEMA_VERSION } from '../schemas/reminder.js';

// ---------------------------------------------------------------------------
// Synthetic test schemas — test-only, not exported, not tied to any entity.
// Factories route through .parse() so a fixture that fails its own schema
// throws at construction rather than silently producing bad test data.
// ---------------------------------------------------------------------------
const V1Schema = BaseRecordSchema.extend({ label: z.string() });
const V2Schema = BaseRecordSchema.extend({ label: z.string(), tag: z.string().nullable() });
const V3Schema = BaseRecordSchema.extend({ label: z.string(), tag: z.string().nullable(), rank: z.number() });

type V1Record = z.infer<typeof V1Schema>;
type V2Record = z.infer<typeof V2Schema>;

const FIXED_CREATED = '2026-01-01T10:00:00.000Z';
const FIXED_UPDATED = '2026-01-01T12:00:00.000Z';

function makeV1Record(id = crypto.randomUUID()): V1Record {
  return V1Schema.parse({
    id,
    createdAt: FIXED_CREATED,
    updatedAt: FIXED_UPDATED,
    deletedAt: null,
    schemaVersion: 1,
    label: 'test',
  });
}

function makeV2Record(id = crypto.randomUUID()): V2Record {
  return V2Schema.parse({
    id,
    createdAt: FIXED_CREATED,
    updatedAt: FIXED_UPDATED,
    deletedAt: null,
    schemaVersion: 2,
    label: 'test',
    tag: null,
  });
}

// ---------------------------------------------------------------------------
// Reusable migration steps
// ---------------------------------------------------------------------------
const v1ToV2: MigrationFn = (r) => ({ ...r, tag: null });
const v2ToV3: MigrationFn = (r) => ({ ...r, rank: 0 });

// ---------------------------------------------------------------------------
// atomicWriteJson mock.
// `vi.fn(actual.atomicWriteJson)` installs the real implementation as the
// persistent base. We avoid capturing it into a module-scoped binding because
// a vi.mock factory runs before module-scope statements are evaluated, so any
// binding referenced there may not yet be initialized.
// ---------------------------------------------------------------------------
vi.mock('./atomic-writer.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./atomic-writer.js')>();
  return { ...actual, atomicWriteJson: vi.fn(actual.atomicWriteJson) };
});

function createMockLogger(): Logger {
  return { debug() {}, info() {}, warn() {}, error() {} };
}

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------
describe('FileStore — migration infrastructure', () => {
  let tempDir: string;
  let entityDir: string;
  let cacheDb: CacheDb;
  let recentWrites: ReturnType<typeof createRecentWrites>;
  const mockLogger = createMockLogger();

  // Writes a record directly to disk, bypassing store.save() — guarantees a cold cache.
  // store.save() would populate the SQLite cache; a get() would then return from cache
  // without executing the migration chain, making chain/failure assertions vacuous.
  async function writeRaw(record: { id: string }): Promise<void> {
    await writeFile(
      path.join(entityDir, `${record.id}.json`),
      JSON.stringify(record)
    );
  }

  beforeEach(async () => {
    tempDir = await mkdtemp(path.join(tmpdir(), 'crm-migration-test-'));
    entityDir = path.join(tempDir, 'test_entities');  // underscore required: CacheDb rejects hyphens in table names
    await mkdir(entityDir, { recursive: true });
    await mkdir(path.join(tempDir, '.quarantine'), { recursive: true });

    cacheDb = new CacheDb(path.join(tempDir, 'cache.db'));
    cacheDb.init();
    recentWrites = createRecentWrites();

    // Clear call history only — NOT mockReset (which would wipe the base implementation).
    // vitest.config.ts sets no clearMocks, so mock.calls accumulate without this.
    vi.mocked(atomicWriteJson).mockClear();
  });

  afterEach(async () => {
    cacheDb.close();
    await rm(tempDir, { recursive: true, force: true });
  });

  // FileStore is constructed inside each test: schema, expectedSchemaVersion, and
  // migrations all vary per test and cannot be shared across them.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  function makeStore(schema: z.ZodTypeAny, expectedSchemaVersion: number, migrations?: Record<number, MigrationFn>): FileStore<any> {
    return new FileStore(
      entityDir,
      schema,
      { cacheDb, logger: mockLogger, recentWrites },
      { expectedSchemaVersion, migrations }
    );
  }

  // Helper: assert a file exists in .quarantine/ whose name contains `id`
  async function expectQuarantined(id: string): Promise<void> {
    const files = await readdir(path.join(tempDir, '.quarantine'));
    expect(files.some((f) => f.includes(id))).toBe(true);
  }

  // ---------------------------------------------------------------------------
  // 1. Happy path — single step (v1 → v2)
  // ---------------------------------------------------------------------------
  it('single-step migration: returns v2 record and writes v2 to disk immediately', async () => {
    const id = crypto.randomUUID();
    await writeRaw(makeV1Record(id));
    const store = makeStore(V2Schema, 2, { 1: v1ToV2 });

    const result = await store.get(id);
    expect(result?.schemaVersion).toBe(2);
    expect(result?.tag).toBeNull();

    // Eager write-back: on-disk file is now v2 without an explicit save()
    const onDisk = JSON.parse(await readFile(path.join(entityDir, `${id}.json`), 'utf-8')) as { schemaVersion: number };
    expect(onDisk.schemaVersion).toBe(2);

    // Cache is warm: second get() (no forceReload) returns migrated record
    const fromCache = await store.get(id);
    expect(fromCache?.schemaVersion).toBe(2);
  });

  // ---------------------------------------------------------------------------
  // 2. Auto-bump overwrites schemaVersion returned by migration function
  // ---------------------------------------------------------------------------
  it('auto-bump: FileStore overwrites any schemaVersion the migration fn returns', async () => {
    const id = crypto.randomUUID();
    await writeRaw(makeV1Record(id));
    const badVersionFn: MigrationFn = (r) => ({ ...r, tag: null, schemaVersion: 99 });
    const store = makeStore(V2Schema, 2, { 1: badVersionFn });

    const result = await store.get(id);
    expect(result?.schemaVersion).toBe(2); // 99 overwritten by auto-bump

    const onDisk = JSON.parse(await readFile(path.join(entityDir, `${id}.json`), 'utf-8')) as { schemaVersion: number };
    expect(onDisk.schemaVersion).toBe(2);
  });

  // ---------------------------------------------------------------------------
  // 3. Happy path — two-step chain (v1 → v2 → v3)
  // ---------------------------------------------------------------------------
  it('two-step chain: applies both steps; exactly one write-back (no intermediate disk write)', async () => {
    const id = crypto.randomUUID();
    await writeRaw(makeV1Record(id));
    const store = makeStore(V3Schema, 3, { 1: v1ToV2, 2: v2ToV3 });

    const result = await store.get(id);
    expect(result?.schemaVersion).toBe(3);
    expect(result?.tag).toBeNull();
    expect(result?.rank).toBe(0);

    const onDisk = JSON.parse(await readFile(path.join(entityDir, `${id}.json`), 'utf-8')) as { schemaVersion: number };
    expect(onDisk.schemaVersion).toBe(3);

    // toHaveBeenCalledTimes(1) proves only one write-back happened;
    // the on-disk-v3 assertion alone cannot rule out an intermediate v2 write.
    expect(vi.mocked(atomicWriteJson)).toHaveBeenCalledTimes(1);
  });

  // ---------------------------------------------------------------------------
  // 4. Cold re-read on already-migrated file: eager write-back does not re-fire
  // Uses a second store with a fresh empty CacheDb over the same entityDir —
  // guarantees a true disk read without relying on forceReload. A forceReload on
  // the original store1 would pass even if it were a warm-cache hit (store1 warmed
  // the cache in the first get), silently reducing this to Test 1's cache check.
  // ---------------------------------------------------------------------------
  it('cold re-read: fresh-cache store over persisted v2 file skips migration and write-back', async () => {
    const id = crypto.randomUUID();
    await writeRaw(makeV1Record(id));
    const store1 = makeStore(V2Schema, 2, { 1: v1ToV2 });

    // First read: migrates v1→v2 and writes back (1 call to atomicWriteJson)
    const first = await store1.get(id);
    expect(first?.schemaVersion).toBe(2);
    expect(vi.mocked(atomicWriteJson)).toHaveBeenCalledTimes(1);

    // Clear call history; construct a second store with a fresh, empty CacheDb.
    // Empty cache guarantees a disk read — no need for forceReload.
    vi.mocked(atomicWriteJson).mockClear();
    const cacheDb2 = new CacheDb(path.join(tempDir, 'cache2.db'));
    cacheDb2.init();
    try {
      const store2 = new FileStore(
        entityDir,
        V2Schema,
        { cacheDb: cacheDb2, logger: mockLogger, recentWrites },
        { expectedSchemaVersion: 2, migrations: { 1: v1ToV2 } }
      );

      // Cold read from the already-v2 file: hits version-match path, no migration, no write-back
      const second = await store2.get(id);
      expect(second?.schemaVersion).toBe(2);
      expect(vi.mocked(atomicWriteJson)).not.toHaveBeenCalled();
    } finally {
      cacheDb2.close();
    }
  });

  // ---------------------------------------------------------------------------
  // 5. Version-match skip: record at current version reads without migration or write-back
  // ---------------------------------------------------------------------------
  it('version-match skip: no migration or write-back for a record already at current version', async () => {
    const id = crypto.randomUUID();
    await writeRaw(makeV2Record(id));
    const store = makeStore(V2Schema, 2); // no migrations

    const result = await store.get(id);
    expect(result?.schemaVersion).toBe(2);
    expect(vi.mocked(atomicWriteJson)).not.toHaveBeenCalled();
  });

  // ---------------------------------------------------------------------------
  // 6. Timestamp preservation — happy path
  // ---------------------------------------------------------------------------
  it('timestamp preservation: write-back preserves original createdAt and updatedAt', async () => {
    const id = crypto.randomUUID();
    await writeRaw(makeV1Record(id));
    const store = makeStore(V2Schema, 2, { 1: v1ToV2 });

    await store.get(id);

    const onDisk = JSON.parse(await readFile(path.join(entityDir, `${id}.json`), 'utf-8')) as {
      createdAt: string;
      updatedAt: string;
    };
    expect(onDisk.updatedAt).toBe(FIXED_UPDATED);
    expect(onDisk.createdAt).toBe(FIXED_CREATED);
  });

  // ---------------------------------------------------------------------------
  // 7. Timestamp preservation — ordering-sensitive
  // Proves restoration runs BEFORE Zod validation. BaseRecordSchema types updatedAt
  // as z.string().datetime({ offset: true }), so 'not-a-date' would fail Zod if
  // restoration ran after validation — quarantining a recoverable file (Failure 3)
  // instead of succeeding. With restoration first, FileStore overwrites the corrupt
  // value before Zod sees it, and the record migrates cleanly.
  // ---------------------------------------------------------------------------
  it('ordering-sensitive: migration that corrupts updatedAt still succeeds (FileStore restores before Zod)', async () => {
    const id = crypto.randomUUID();
    await writeRaw(makeV1Record(id));
    const corruptsTimestamp: MigrationFn = (r) => ({ ...r, tag: null, updatedAt: 'not-a-date' });
    const store = makeStore(V2Schema, 2, { 1: corruptsTimestamp });

    // Must succeed — FileStore force-restores updatedAt before Zod validates
    const result = await store.get(id);
    expect(result?.schemaVersion).toBe(2);
    expect(result?.updatedAt).toBe(FIXED_UPDATED); // original, not 'not-a-date'

    const onDisk = JSON.parse(await readFile(path.join(entityDir, `${id}.json`), 'utf-8')) as { updatedAt: string };
    expect(onDisk.updatedAt).toBe(FIXED_UPDATED);
  });

  // ---------------------------------------------------------------------------
  // 8. Mid-chain atomicity: disk and cache stay consistent on partial chain failure
  // ---------------------------------------------------------------------------
  it('mid-chain failure: disk holds schemaVersion:1 and cache is empty (no partial v2 anywhere)', async () => {
    const id = crypto.randomUUID();
    // Raw write guarantees cold cache — store.save() would warm the cache and
    // cause get() to return without running the chain, making all assertions vacuous.
    await writeRaw(makeV1Record(id));

    const throwsAtV3: MigrationFn = () => { throw new Error('mid-chain error'); };
    const store = makeStore(V3Schema, 3, { 1: v1ToV2, 2: throwsAtV3 });

    await expect(store.get(id)).rejects.toBeInstanceOf(FileStoreQuarantineError);

    // Disk state: the quarantined file's content is the original v1 record —
    // the v1→v2 in-memory intermediate was never written to disk
    const qDir = path.join(tempDir, '.quarantine');
    const qFiles = await readdir(qDir);
    const qFile = qFiles.find((f) => f.includes(id));
    expect(qFile).toBeTruthy();
    const qContent = JSON.parse(await readFile(path.join(qDir, qFile!), 'utf-8')) as { schemaVersion: number };
    expect(qContent.schemaVersion).toBe(1);

    // Cache state: direct lookup, not store.get() which routes through cache+disk and
    // would return null for either "cache empty" or "file not on disk" — indistinguishable.
    // 'test_entities' = path.basename(entityDir); coupled to this test's entityDir name.
    const cached = cacheDb.get('test_entities', id);
    expect(cached).toBeNull();
  });

  // ---------------------------------------------------------------------------
  // Failure 1: migration function threw → quarantine
  // ---------------------------------------------------------------------------
  it('Failure 1: migration fn threw → FileStoreQuarantineError; reason names step and error; file quarantined', async () => {
    const id = crypto.randomUUID();
    await writeRaw(makeV1Record(id));
    const throws: MigrationFn = () => { throw new Error('bad data'); };
    const store = makeStore(V2Schema, 2, { 1: throws });

    const err = await store.get(id).catch((e) => e);
    expect(err).toBeInstanceOf(FileStoreQuarantineError);
    expect((err as FileStoreQuarantineError).reason).toContain('Migration v1→v2 threw');
    expect((err as FileStoreQuarantineError).reason).toContain('bad data');

    await expectQuarantined(id);
  });

  // ---------------------------------------------------------------------------
  // Failure 2: no migration registered for a required step → quarantine
  // ---------------------------------------------------------------------------
  describe('Failure 2: no migration registered', () => {
    it('missing first step (v1→v2): quarantine with "no migration function registered" and step in reason', async () => {
      const id = crypto.randomUUID();
      await writeRaw(makeV1Record(id));
      const store = makeStore(V2Schema, 2, {}); // empty map

      const err = await store.get(id).catch((e) => e);
      expect(err).toBeInstanceOf(FileStoreQuarantineError);
      expect((err as FileStoreQuarantineError).reason).toContain('no migration function registered');
      expect((err as FileStoreQuarantineError).reason).toContain('v1→v2');

      await expectQuarantined(id);
    });

    it('chain gap (v2→v3 missing): reason identifies the missing step, not the registered one', async () => {
      const id = crypto.randomUUID();
      await writeRaw(makeV1Record(id));
      const store = makeStore(V3Schema, 3, { 1: v1ToV2 }); // missing 2→3

      const err = await store.get(id).catch((e) => e);
      expect(err).toBeInstanceOf(FileStoreQuarantineError);
      expect((err as FileStoreQuarantineError).reason).toContain('v2→v3');
      expect((err as FileStoreQuarantineError).reason).not.toContain('v1→v2');
    });
  });

  // ---------------------------------------------------------------------------
  // Failure 3: post-migration Zod validation failed → quarantine
  // Reason must contain 'current-schema validation' and NOT 'threw' (distinct from Failure 1).
  // ---------------------------------------------------------------------------
  it('Failure 3: buggy migration (returns invalid shape) → quarantine with distinct reason, no "threw"', async () => {
    const id = crypto.randomUUID();
    await writeRaw(makeV1Record(id));
    // Returns only the id — drops all other required fields; does not throw
    const buggy: MigrationFn = (r) => ({ id: (r as { id: string }).id });
    const store = makeStore(V2Schema, 2, { 1: buggy });

    const err = await store.get(id).catch((e) => e);
    expect(err).toBeInstanceOf(FileStoreQuarantineError);
    expect((err as FileStoreQuarantineError).reason).toContain('current-schema validation');
    expect((err as FileStoreQuarantineError).reason).not.toContain('threw'); // distinct from Failure 1

    await expectQuarantined(id);
  });

  // ---------------------------------------------------------------------------
  // Failure 4: write-back disk failure → StorageError, no quarantine, retryable
  // 4a + 4b in one test. mockRejectedValueOnce is consumed in 4a (first get());
  // 4b's forceReload call uses the base implementation — the -Once queue is drained
  // within this test so nothing leaks into subsequent tests' beforeEach mockClear().
  // ---------------------------------------------------------------------------
  it('Failure 4: write-back disk error → StorageError (not quarantine); original intact; retry succeeds', async () => {
    const id = crypto.randomUUID();
    await writeRaw(makeV1Record(id));
    const store = makeStore(V2Schema, 2, { 1: v1ToV2 });

    // 4a — propagation: mock rejects once; migration succeeds but write-back throws
    vi.mocked(atomicWriteJson).mockRejectedValueOnce(new Error('disk full'));

    const err = await store.get(id).catch((e) => e);
    expect(err).toBeInstanceOf(StorageError);
    expect(err).not.toBeInstanceOf(FileStoreQuarantineError);

    // Original file is intact at its original path — not quarantined, still schemaVersion:1
    const onDisk = JSON.parse(await readFile(path.join(entityDir, `${id}.json`), 'utf-8')) as { schemaVersion: number };
    expect(onDisk.schemaVersion).toBe(1);

    // 4b — retryability: mockRejectedValueOnce consumed above; base impl used for this call
    const retried = await store.get(id, { forceReload: true });
    expect(retried?.schemaVersion).toBe(2);
  });

  // ---------------------------------------------------------------------------
  // Version-too-high: no regression (unchanged pre-Sprint-09 behaviour)
  // ---------------------------------------------------------------------------
  it('version-too-high: quarantine with "too high" in reason; migration infrastructure does not alter this path', async () => {
    const id = crypto.randomUUID();
    // Write a file at schemaVersion:3 against a store that expects v2
    await writeRaw({ id, createdAt: FIXED_CREATED, updatedAt: FIXED_UPDATED, deletedAt: null, schemaVersion: 3, label: 'test', tag: null });
    const store = makeStore(V2Schema, 2, { 1: v1ToV2 });

    const err = await store.get(id).catch((e) => e);
    expect(err).toBeInstanceOf(FileStoreQuarantineError);
    // Actual reason: "schema version too high (found 3, expected 2) — file may be from a newer app version"
    expect((err as FileStoreQuarantineError).reason).toContain('too high');

    await expectQuarantined(id);
  });

  // ---------------------------------------------------------------------------
  // getAll(): mixed-version with on-disk write-back assertion
  // ---------------------------------------------------------------------------
  it('getAll(): migrates (a), quarantines (b), passes (c); eager write-back fires through getAll path', async () => {
    // Single migration fn dispatches on label to exercise success and failure paths
    // through one store. Note: getAll() only catches FileStoreQuarantineError —
    // a StorageError from write-back would propagate and abort the whole call.
    const v1ToV2Mixed: MigrationFn = (r) => {
      if ((r as { label?: string }).label === 'fail') throw new Error('migration error');
      return { ...r, tag: null };
    };
    const store = makeStore(V2Schema, 2, { 1: v1ToV2Mixed });

    const idA = crypto.randomUUID();
    const idB = crypto.randomUUID();
    const idC = crypto.randomUUID();

    await writeRaw({ ...makeV1Record(idA), label: 'good' }); // (a) migration succeeds
    await writeRaw({ ...makeV1Record(idB), label: 'fail' }); // (b) migration throws → Failure 1
    await writeRaw(makeV2Record(idC));                        // (c) already at v2

    const results = await store.getAll();

    expect(results).toHaveLength(2);
    expect(results.some((r) => r.id === idA && r.schemaVersion === 2)).toBe(true);
    expect(results.some((r) => r.id === idC && r.schemaVersion === 2)).toBe(true);
    expect(results.some((r) => r.id === idB)).toBe(false); // quarantined

    // Eager write-back fires through getAll(): (a) is now v2 on disk
    const onDiskA = JSON.parse(await readFile(path.join(entityDir, `${idA}.json`), 'utf-8')) as { schemaVersion: number };
    expect(onDiskA.schemaVersion).toBe(2);
  });

  // ---------------------------------------------------------------------------
  // Scope boundary: all production entity schema versions remain at 1
  // ---------------------------------------------------------------------------
  it('scope boundary: no production entity schemaVersion was bumped this sprint', () => {
    expect(CONTACT_SCHEMA_VERSION).toBe(1);
    expect(INTERACTION_SCHEMA_VERSION).toBe(1);
    expect(INBOX_ENTRY_SCHEMA_VERSION).toBe(1);
    expect(REMINDER_SCHEMA_VERSION).toBe(1);
  });
});
