import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, writeFile, readFile, mkdir, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { z } from 'zod';
import Database from 'better-sqlite3';
import { FileStore, FileStoreValidationError, FileStoreQuarantineError } from './file-store.js';
import { CacheDb } from './cache-db.js';
import { createRecentWrites } from './recent-writes.js';
import { BaseRecordSchema } from './schemas/base-record.js';
import type { Logger } from './logger.js';

// Test schema extending BaseRecord
const TestRecordSchema = BaseRecordSchema.extend({
  name: z.string().min(1),
  value: z.number().optional(),
});

type TestRecord = z.infer<typeof TestRecordSchema>;

function createTestRecord(overrides: Partial<TestRecord> = {}): TestRecord {
  return {
    id: crypto.randomUUID(),
    createdAt: '2026-05-01T12:00:00.000Z',
    updatedAt: '2026-05-01T12:00:00.000Z',
    deletedAt: null,
    schemaVersion: 1,
    name: 'Test Record',
    ...overrides,
  };
}

// Mock logger that captures log calls
function createMockLogger(): Logger & { calls: { level: string; op: string; msg: string; meta?: object }[] } {
  const calls: { level: string; op: string; msg: string; meta?: object }[] = [];
  return {
    calls,
    debug(op, msg, meta) {
      calls.push({ level: 'debug', op, msg, meta });
    },
    info(op, msg, meta) {
      calls.push({ level: 'info', op, msg, meta });
    },
    warn(op, msg, meta) {
      calls.push({ level: 'warn', op, msg, meta });
    },
    error(op, msg, meta) {
      calls.push({ level: 'error', op, msg, meta });
    },
  };
}

describe('FileStore', () => {
  let tempDir: string;
  let dataDir: string;
  let cacheDbPath: string;
  let cacheDb: CacheDb;
  let logger: ReturnType<typeof createMockLogger>;
  let recentWrites: ReturnType<typeof createRecentWrites>;
  let store: FileStore<TestRecord>;

  beforeEach(async () => {
    tempDir = await mkdtemp(path.join(tmpdir(), 'file-store-test-'));
    dataDir = path.join(tempDir, 'contacts');
    cacheDbPath = path.join(tempDir, 'cache.db');

    await mkdir(dataDir, { recursive: true });

    cacheDb = new CacheDb(cacheDbPath);
    cacheDb.init();

    logger = createMockLogger();
    recentWrites = createRecentWrites();

    store = new FileStore(dataDir, TestRecordSchema, { cacheDb, logger, recentWrites }, { expectedSchemaVersion: 1 });
  });

  afterEach(async () => {
    cacheDb.close();
    await rm(tempDir, { recursive: true, force: true });
  });

  describe('save', () => {
    it('saves a new record with auto-set createdAt and updatedAt', async () => {
      const record = createTestRecord({
        createdAt: '2000-01-01T00:00:00.000Z',
        updatedAt: '2000-01-01T00:00:00.000Z',
      });

      const beforeSave = Date.now();
      await store.save(record);
      const afterSave = Date.now();

      // Read from disk to verify
      const filePath = path.join(dataDir, `${record.id}.json`);
      const content = await readFile(filePath, 'utf-8');
      const saved = JSON.parse(content);

      // createdAt and updatedAt should be auto-set (not the old values)
      const savedCreatedAt = new Date(saved.createdAt).getTime();
      const savedUpdatedAt = new Date(saved.updatedAt).getTime();

      expect(savedCreatedAt).toBeGreaterThanOrEqual(beforeSave);
      expect(savedCreatedAt).toBeLessThanOrEqual(afterSave);
      expect(savedUpdatedAt).toBeGreaterThanOrEqual(beforeSave);
      expect(savedUpdatedAt).toBeLessThanOrEqual(afterSave);
    });

    it('saves an existing record preserving createdAt but updating updatedAt', async () => {
      const record = createTestRecord();
      await store.save(record);

      // Get the saved record to see the auto-set createdAt
      const firstSave = await store.get(record.id, { forceReload: true });
      const originalCreatedAt = firstSave!.createdAt;

      // Wait a tiny bit to ensure different timestamp
      await new Promise((r) => setTimeout(r, 10));

      // Save again (update)
      const updated = { ...firstSave!, name: 'Updated Name' };
      await store.save(updated);

      const secondSave = await store.get(record.id, { forceReload: true });

      // createdAt should be preserved
      expect(secondSave!.createdAt).toBe(originalCreatedAt);
      // updatedAt should be newer
      expect(new Date(secondSave!.updatedAt).getTime()).toBeGreaterThan(
        new Date(firstSave!.updatedAt).getTime()
      );
    });

    it('preserves caller timestamps when preserveTimestamps is true', async () => {
      const record = createTestRecord({
        createdAt: '2020-01-01T00:00:00.000Z',
        updatedAt: '2020-06-15T12:30:00.000Z',
      });

      await store.save(record, { preserveTimestamps: true });

      const saved = await store.get(record.id, { forceReload: true });

      expect(saved!.createdAt).toBe('2020-01-01T00:00:00.000Z');
      expect(saved!.updatedAt).toBe('2020-06-15T12:30:00.000Z');
    });

    it('throws FileStoreValidationError and never writes when validation fails', async () => {
      const invalidRecord = createTestRecord({ name: '' }); // name must be non-empty

      await expect(store.save(invalidRecord)).rejects.toThrow(FileStoreValidationError);

      // Verify file was never written
      const files = await readdir(dataDir);
      expect(files).toHaveLength(0);
    });
  });

  describe('get', () => {
    it('returns record when file exists and is valid', async () => {
      const record = createTestRecord();
      await store.save(record);

      // Clear cache to force disk read
      cacheDb.clear();

      const retrieved = await store.get(record.id);

      expect(retrieved).not.toBeNull();
      expect(retrieved!.id).toBe(record.id);
      expect(retrieved!.name).toBe(record.name);
    });

    it('returns null when file does not exist', async () => {
      const result = await store.get('non-existent-id');
      expect(result).toBeNull();
    });

    it('quarantines and throws when JSON is invalid', async () => {
      const record = createTestRecord();
      const filePath = path.join(dataDir, `${record.id}.json`);

      // Write invalid JSON directly
      await writeFile(filePath, 'not valid json {{{');

      await expect(store.get(record.id)).rejects.toThrow(FileStoreQuarantineError);

      // Verify file was quarantined
      const quarantineDir = path.join(tempDir, '.quarantine');
      const quarantinedFiles = await readdir(quarantineDir);
      expect(quarantinedFiles.length).toBe(1);
      expect(quarantinedFiles[0]).toContain(record.id);
      expect(quarantinedFiles[0].endsWith('.quarantined')).toBe(true);

      // Original file should be gone
      const dataFiles = await readdir(dataDir);
      expect(dataFiles).not.toContain(`${record.id}.json`);
    });

    it('quarantines and throws when Zod validation fails', async () => {
      const record = createTestRecord();
      const filePath = path.join(dataDir, `${record.id}.json`);

      // Write JSON that passes JSON.parse but fails Zod (missing required field)
      const invalidData = {
        id: record.id,
        createdAt: record.createdAt,
        updatedAt: record.updatedAt,
        deletedAt: null,
        schemaVersion: 1,
        // name is missing
      };
      await writeFile(filePath, JSON.stringify(invalidData));

      await expect(store.get(record.id)).rejects.toThrow(FileStoreQuarantineError);

      // Verify quarantine
      const quarantineDir = path.join(tempDir, '.quarantine');
      const quarantinedFiles = await readdir(quarantineDir);
      expect(quarantinedFiles.length).toBe(1);
    });

    it('quarantines and throws when schema version is too high', async () => {
      const record = createTestRecord({ schemaVersion: 999 });
      const filePath = path.join(dataDir, `${record.id}.json`);

      await writeFile(filePath, JSON.stringify(record));

      const error = await store.get(record.id).catch((e) => e);

      expect(error).toBeInstanceOf(FileStoreQuarantineError);
      expect(error.reason).toContain('schema version too high');
      expect(error.reason).toContain('found 999');
      expect(error.reason).toContain('expected 1');
    });
  });

  describe('getAll', () => {
    it('returns all non-deleted records', async () => {
      const record1 = createTestRecord({ name: 'Record 1' });
      const record2 = createTestRecord({ name: 'Record 2' });
      const deletedRecord = createTestRecord({ name: 'Deleted' });

      await store.save(record1);
      await store.save(record2);
      await store.save(deletedRecord);
      await store.delete(deletedRecord.id);

      const all = await store.getAll();

      expect(all).toHaveLength(2);
      expect(all.map((r) => r.name).sort()).toEqual(['Record 1', 'Record 2']);
    });

    it('includes deleted records when includeDeleted is true', async () => {
      const record = createTestRecord();
      await store.save(record);
      await store.delete(record.id);

      const allWithDeleted = await store.getAll({ includeDeleted: true });

      expect(allWithDeleted).toHaveLength(1);
      expect(allWithDeleted[0].deletedAt).not.toBeNull();
    });
  });

  describe('delete', () => {
    it('soft-deletes by setting deletedAt', async () => {
      const record = createTestRecord();
      await store.save(record);

      const beforeDelete = Date.now();
      await store.delete(record.id);
      const afterDelete = Date.now();

      const deleted = await store.get(record.id, { forceReload: true });

      expect(deleted).not.toBeNull();
      expect(deleted!.deletedAt).not.toBeNull();

      const deletedAt = new Date(deleted!.deletedAt!).getTime();
      expect(deletedAt).toBeGreaterThanOrEqual(beforeDelete);
      expect(deletedAt).toBeLessThanOrEqual(afterDelete);
    });

    it('operates on disk state when cache is stale', async () => {
      const record = createTestRecord({ name: 'Original Name' });
      await store.save(record);

      // Mutate cache directly via raw database connection (simulating stale cache)
      const rawDb = new Database(cacheDbPath);
      const staleData = { ...record, name: 'Stale Cache Name' };
      rawDb.prepare(`UPDATE contacts SET data = ? WHERE id = ?`).run(
        JSON.stringify(staleData),
        record.id
      );
      rawDb.close();

      // Delete should use disk state (Original Name), not cache (Stale Cache Name)
      await store.delete(record.id);

      // Verify the saved file has the disk-correct name plus deletedAt
      const filePath = path.join(dataDir, `${record.id}.json`);
      const content = await readFile(filePath, 'utf-8');
      const saved = JSON.parse(content);

      expect(saved.name).toBe('Original Name'); // From disk, not stale cache
      expect(saved.deletedAt).not.toBeNull();
    });

    it('is idempotent and preserves original deletedAt on second call', async () => {
      const record = createTestRecord();
      await store.save(record);

      // First delete
      await store.delete(record.id);
      const firstDelete = await store.get(record.id, { forceReload: true });
      const originalDeletedAt = firstDelete!.deletedAt;

      // Wait to ensure different timestamp if it were to change
      await new Promise((r) => setTimeout(r, 10));

      // Second delete - should be a no-op
      await store.delete(record.id);
      const secondDelete = await store.get(record.id, { forceReload: true });

      // deletedAt should be unchanged
      expect(secondDelete!.deletedAt).toBe(originalDeletedAt);

      // Verify warning was logged
      const warnCalls = logger.calls.filter(
        (c) => c.level === 'warn' && c.op === 'fileStore.delete' && c.msg.includes('already-deleted')
      );
      expect(warnCalls.length).toBe(1);
    });
  });

  describe('exists', () => {
    it('returns true when file exists', async () => {
      const record = createTestRecord();
      await store.save(record);

      expect(await store.exists(record.id)).toBe(true);
    });

    it('returns false when file does not exist', async () => {
      expect(await store.exists('non-existent-id')).toBe(false);
    });
  });

  describe('cache integration', () => {
    it('returns cached value on subsequent gets', async () => {
      const record = createTestRecord();
      await store.save(record);

      // First get populates cache from save
      await store.get(record.id);

      // Modify the disk file directly (simulate external change without going through store)
      const filePath = path.join(dataDir, `${record.id}.json`);
      const diskData = JSON.parse(await readFile(filePath, 'utf-8'));
      diskData.name = 'Modified on disk';
      await writeFile(filePath, JSON.stringify(diskData));

      // Second get should return cached value (not disk)
      const second = await store.get(record.id);

      expect(second!.name).toBe(record.name); // Still the original cached name
    });

    it('reads from disk on cache miss', async () => {
      const record = createTestRecord();
      await store.save(record);

      // Clear cache
      cacheDb.clear();

      // Get should read from disk
      const retrieved = await store.get(record.id);

      expect(retrieved).not.toBeNull();
      expect(retrieved!.id).toBe(record.id);
    });

    it('returns disk value and updates cache when forceReload is true', async () => {
      const record = createTestRecord();
      await store.save(record);

      // Mutate cache directly via raw database connection (simulating out-of-band state)
      const rawDb = new Database(cacheDbPath);
      const mutatedData = { ...record, name: 'Mutated in cache' };
      rawDb.prepare(`UPDATE contacts SET data = ? WHERE id = ?`).run(
        JSON.stringify(mutatedData),
        record.id
      );
      rawDb.close();

      // Regular get returns cached (mutated) value
      const cached = await store.get(record.id);
      expect(cached!.name).toBe('Mutated in cache');

      // forceReload reads from disk and updates cache
      const fresh = await store.get(record.id, { forceReload: true });
      expect(fresh!.name).toBe(record.name);

      // Subsequent get (no forceReload) should return updated cache
      const afterReload = await store.get(record.id);
      expect(afterReload!.name).toBe(record.name);
    });
  });

  describe('external file creation', () => {
    it('reads file created externally without going through FileStore', async () => {
      const record = createTestRecord({ name: 'External Record' });
      const filePath = path.join(dataDir, `${record.id}.json`);

      // Write file directly to disk (simulating external tool)
      await writeFile(filePath, JSON.stringify(record, null, 2));

      // Create a fresh FileStore instance (no prior knowledge of this file)
      const freshStore = new FileStore(
        dataDir,
        TestRecordSchema,
        { cacheDb, logger, recentWrites },
        { expectedSchemaVersion: 1 }
      );

      const retrieved = await freshStore.get(record.id);

      expect(retrieved).not.toBeNull();
      expect(retrieved!.id).toBe(record.id);
      expect(retrieved!.name).toBe('External Record');
    });
  });
});
