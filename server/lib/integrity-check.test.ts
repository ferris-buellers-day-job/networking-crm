import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtemp, rm, writeFile, mkdir, chmod } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { runIntegrityCheck } from './integrity-check.js';
import { CacheDb } from './cache-db.js';

describe('IntegrityCheck', () => {
  let tempDir: string;
  let dataPath: string;
  let cacheDbPath: string;
  let cache: CacheDb;

  beforeEach(async () => {
    tempDir = await mkdtemp(path.join(tmpdir(), 'integrity-check-test-'));
    dataPath = path.join(tempDir, 'data');
    cacheDbPath = path.join(tempDir, 'cache.db');

    await mkdir(dataPath, { recursive: true });

    cache = new CacheDb(cacheDbPath);
    cache.init();

    // Suppress console.error during tests (quarantine warnings)
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(async () => {
    cache.close();
    vi.restoreAllMocks();
    await rm(tempDir, { recursive: true, force: true });
  });

  describe('clean state', () => {
    it('reports no issues when everything is valid', async () => {
      // Create valid .schema-version file
      await writeFile(path.join(dataPath, '.schema-version'), '1');

      const report = await runIntegrityCheck(dataPath, cache, {
        expectedSchemaVersion: 1,
        entityDirectories: [],
      });

      expect(report.schemaVersionOk).toBe(true);
      expect(report.expectedSchemaVersion).toBe(1);
      expect(report.foundSchemaVersion).toBe(1);
      expect(report.conflictFiles).toHaveLength(0);
      expect(report.quarantinedFiles).toHaveLength(0);
      expect(report.orphanedReferences).toHaveLength(0);
      expect(report.cacheRebuilt).toBe(false);
      expect(report.errors).toHaveLength(0);
    });
  });

  describe('schema version', () => {
    it('reports missing .schema-version file', async () => {
      // Don't create .schema-version file

      const report = await runIntegrityCheck(dataPath, cache, {
        expectedSchemaVersion: 1,
        entityDirectories: [],
      });

      expect(report.schemaVersionOk).toBe(false);
      expect(report.foundSchemaVersion).toBeNull();
      expect(report.errors).toContain('.schema-version file not found');
    });

    it('reports mismatched schema version', async () => {
      // Create .schema-version with wrong version
      await writeFile(path.join(dataPath, '.schema-version'), '2');

      const report = await runIntegrityCheck(dataPath, cache, {
        expectedSchemaVersion: 1,
        entityDirectories: [],
      });

      expect(report.schemaVersionOk).toBe(false);
      expect(report.expectedSchemaVersion).toBe(1);
      expect(report.foundSchemaVersion).toBe(2);
      expect(report.errors).toHaveLength(0); // Mismatch is not an error, just flagged
    });

    it('reports invalid schema version content', async () => {
      await writeFile(path.join(dataPath, '.schema-version'), 'not-a-number');

      const report = await runIntegrityCheck(dataPath, cache, {
        expectedSchemaVersion: 1,
        entityDirectories: [],
      });

      expect(report.schemaVersionOk).toBe(false);
      expect(report.foundSchemaVersion).toBeNull();
      expect(report.errors.some((e) => e.includes('invalid content'))).toBe(true);
    });
  });

  describe('iCloud conflict files', () => {
    beforeEach(async () => {
      await writeFile(path.join(dataPath, '.schema-version'), '1');
      await mkdir(path.join(dataPath, 'contacts'), { recursive: true });
    });

    it('detects iCloud conflict file with space-number pattern', async () => {
      // Create conflict file: "contact 2.json"
      await writeFile(path.join(dataPath, 'contacts', 'contact 2.json'), '{}');

      const report = await runIntegrityCheck(dataPath, cache, {
        expectedSchemaVersion: 1,
        entityDirectories: [],
      });

      expect(report.conflictFiles).toHaveLength(1);
      expect(report.conflictFiles[0]).toContain('contact 2.json');
    });

    it('detects multiple conflict files', async () => {
      await writeFile(path.join(dataPath, 'contacts', 'alice 2.json'), '{}');
      await writeFile(path.join(dataPath, 'contacts', 'bob 17.json'), '{}');

      const report = await runIntegrityCheck(dataPath, cache, {
        expectedSchemaVersion: 1,
        entityDirectories: [],
      });

      expect(report.conflictFiles).toHaveLength(2);
    });

    it('does NOT flag normal files with hyphens as conflicts', async () => {
      // "contact-2.json" is a normal file, not an iCloud conflict
      await writeFile(path.join(dataPath, 'contacts', 'contact-2.json'), '{}');

      const report = await runIntegrityCheck(dataPath, cache, {
        expectedSchemaVersion: 1,
        entityDirectories: [],
      });

      expect(report.conflictFiles).toHaveLength(0);
    });

    it('does NOT flag normal .json files as conflicts', async () => {
      await writeFile(path.join(dataPath, 'contacts', 'contact.json'), '{}');

      const report = await runIntegrityCheck(dataPath, cache, {
        expectedSchemaVersion: 1,
        entityDirectories: [],
      });

      expect(report.conflictFiles).toHaveLength(0);
    });

    it('scans nested directories for conflicts', async () => {
      await mkdir(path.join(dataPath, 'contacts', 'nested'), { recursive: true });
      await writeFile(path.join(dataPath, 'contacts', 'nested', 'deep 3.json'), '{}');

      const report = await runIntegrityCheck(dataPath, cache, {
        expectedSchemaVersion: 1,
        entityDirectories: [],
      });

      expect(report.conflictFiles).toHaveLength(1);
      expect(report.conflictFiles[0]).toContain('deep 3.json');
    });
  });

  describe('quarantined files', () => {
    beforeEach(async () => {
      await writeFile(path.join(dataPath, '.schema-version'), '1');
    });

    it('lists files in .quarantine directory', async () => {
      await mkdir(path.join(dataPath, '.quarantine'), { recursive: true });
      await writeFile(
        path.join(dataPath, '.quarantine', 'bad-file.json.2026-05-01T12-00-00.000Z.quarantined'),
        '{}'
      );

      const report = await runIntegrityCheck(dataPath, cache, {
        expectedSchemaVersion: 1,
        entityDirectories: [],
      });

      expect(report.quarantinedFiles).toHaveLength(1);
      expect(report.quarantinedFiles[0]).toContain('bad-file.json');
    });

    it('prints warning to stderr for each quarantined file', async () => {
      await mkdir(path.join(dataPath, '.quarantine'), { recursive: true });
      await writeFile(path.join(dataPath, '.quarantine', 'quarantined1.json'), '{}');
      await writeFile(path.join(dataPath, '.quarantine', 'quarantined2.json'), '{}');

      await runIntegrityCheck(dataPath, cache, {
        expectedSchemaVersion: 1,
        entityDirectories: [],
      });

      expect(console.error).toHaveBeenCalledTimes(2);
      expect(console.error).toHaveBeenCalledWith(
        expect.stringContaining('⚠️  QUARANTINED (existing):')
      );
    });

    it('handles missing .quarantine directory gracefully', async () => {
      // Don't create .quarantine directory

      const report = await runIntegrityCheck(dataPath, cache, {
        expectedSchemaVersion: 1,
        entityDirectories: [],
      });

      expect(report.quarantinedFiles).toHaveLength(0);
      expect(report.errors).toHaveLength(0);
    });
  });

  describe('cache staleness', () => {
    beforeEach(async () => {
      await writeFile(path.join(dataPath, '.schema-version'), '1');
      await mkdir(path.join(dataPath, 'contacts'), { recursive: true });
    });

    it('detects stale cache entries when file is newer than cache', async () => {
      const id = '12345678-1234-1234-1234-123456789abc';
      const filePath = path.join(dataPath, 'contacts', `${id}.json`);

      // Create file
      await writeFile(filePath, JSON.stringify({ id, name: 'Test' }));

      // Add cache entry with old timestamp
      cache.upsert('contacts', {
        id,
        createdAt: '2020-01-01T00:00:00.000Z',
        updatedAt: '2020-01-01T00:00:00.000Z', // Very old
        deletedAt: null,
        schemaVersion: 1,
      });

      const report = await runIntegrityCheck(dataPath, cache, {
        expectedSchemaVersion: 1,
        entityDirectories: ['contacts'],
      });

      expect(report.cacheRebuilt).toBe(true);
    });

    it('detects missing cache entries', async () => {
      const id = '12345678-1234-1234-1234-123456789abc';
      const filePath = path.join(dataPath, 'contacts', `${id}.json`);

      // Create file but don't add to cache
      await writeFile(filePath, JSON.stringify({ id, name: 'Test' }));

      const report = await runIntegrityCheck(dataPath, cache, {
        expectedSchemaVersion: 1,
        entityDirectories: ['contacts'],
      });

      expect(report.cacheRebuilt).toBe(true);
    });

    it('reports no staleness when cache is up to date', async () => {
      const id = '12345678-1234-1234-1234-123456789abc';
      const filePath = path.join(dataPath, 'contacts', `${id}.json`);

      // Create file
      await writeFile(filePath, JSON.stringify({ id, name: 'Test' }));

      // Sleep between file write and cache timestamp to avoid clock-asymmetry false positives.
      // The filesystem's mtime rounding and JavaScript's Date sampling are independent clocks;
      // immediate sequential calls can produce mtime > cacheTime by a millisecond. The 10ms gap
      // ensures the cache timestamp is definitively after the file mtime.
      await new Promise((r) => setTimeout(r, 10));

      // Add cache entry with current timestamp
      const now = new Date().toISOString();
      cache.upsert('contacts', {
        id,
        createdAt: now,
        updatedAt: now,
        deletedAt: null,
        schemaVersion: 1,
      });

      const report = await runIntegrityCheck(dataPath, cache, {
        expectedSchemaVersion: 1,
        entityDirectories: ['contacts'],
      });

      expect(report.cacheRebuilt).toBe(false);
    });

    it('handles empty entityDirectories array', async () => {
      const report = await runIntegrityCheck(dataPath, cache, {
        expectedSchemaVersion: 1,
        entityDirectories: [],
      });

      expect(report.cacheRebuilt).toBe(false);
      expect(report.errors).toHaveLength(0);
    });

    it('handles non-existent entity directory gracefully', async () => {
      const report = await runIntegrityCheck(dataPath, cache, {
        expectedSchemaVersion: 1,
        entityDirectories: ['nonexistent'],
      });

      expect(report.cacheRebuilt).toBe(false);
      expect(report.errors).toHaveLength(0); // ENOENT is expected, not an error
    });
  });

  describe('error handling', () => {
    beforeEach(async () => {
      await writeFile(path.join(dataPath, '.schema-version'), '1');
    });

    it('collects errors and never throws', async () => {
      // Create a directory that will cause issues when treated as file
      await mkdir(path.join(dataPath, 'contacts'), { recursive: true });

      // This should complete without throwing
      const report = await runIntegrityCheck(dataPath, cache, {
        expectedSchemaVersion: 1,
        entityDirectories: ['contacts'],
      });

      // Report should be returned even if there were issues
      expect(report).toBeDefined();
      expect(report.schemaVersionOk).toBe(true);
    });

    it('reports read errors in errors array', async () => {
      // Create unreadable .schema-version file (Unix only)
      const schemaPath = path.join(dataPath, '.schema-version');
      await writeFile(schemaPath, '1');

      // Make file unreadable
      try {
        await chmod(schemaPath, 0o000);
      } catch {
        // Skip test on systems where chmod doesn't work as expected
        return;
      }

      const report = await runIntegrityCheck(dataPath, cache, {
        expectedSchemaVersion: 1,
        entityDirectories: [],
      });

      // Should have error about reading schema version
      expect(report.errors.length).toBeGreaterThan(0);
      expect(report.schemaVersionOk).toBe(false);

      // Restore permissions for cleanup
      await chmod(schemaPath, 0o644);
    });
  });

  describe('orphanedReferences', () => {
    it('returns empty array (placeholder for Sprint 04)', async () => {
      await writeFile(path.join(dataPath, '.schema-version'), '1');

      const report = await runIntegrityCheck(dataPath, cache, {
        expectedSchemaVersion: 1,
        entityDirectories: [],
      });

      expect(report.orphanedReferences).toEqual([]);
    });
  });
});
