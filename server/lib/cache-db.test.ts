import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import { CacheDb, CacheDataCorruptedError } from './cache-db.js';
import type { BaseRecord } from './schemas/base-record.js';

function createTestRecord(
  overrides: Partial<BaseRecord> & Record<string, unknown> = {}
): BaseRecord & { name: string } & Record<string, unknown> {
  return {
    id: crypto.randomUUID(),
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    deletedAt: null,
    schemaVersion: 1,
    name: 'Test Record',
    ...overrides,
  };
}

describe('CacheDb', () => {
  let tempDir: string;
  let dbPath: string;
  let db: CacheDb;

  beforeEach(async () => {
    tempDir = await mkdtemp(path.join(tmpdir(), 'cache-db-test-'));
    dbPath = path.join(tempDir, 'test-cache.db');
    db = new CacheDb(dbPath);
    db.init();
  });

  afterEach(async () => {
    db.close();
    await rm(tempDir, { recursive: true, force: true });
  });

  describe('init', () => {
    it('creates database file', async () => {
      const { stat } = await import('node:fs/promises');
      const stats = await stat(dbPath);
      expect(stats.isFile()).toBe(true);
    });

    it('can be called multiple times without error', () => {
      expect(() => {
        db.init();
        db.init();
      }).not.toThrow();
    });
  });

  describe('upsert and get', () => {
    it('stores and retrieves a record', () => {
      const record = createTestRecord({ name: 'Alice' });

      db.upsert('contacts', record);
      const retrieved = db.get('contacts', record.id) as typeof record;

      expect(retrieved).toEqual(record);
    });

    it('returns null for non-existent record', () => {
      const result = db.get('contacts', 'non-existent-id');
      expect(result).toBeNull();
    });

    it('updates existing record on upsert', () => {
      const record = createTestRecord({ name: 'Alice' });
      db.upsert('contacts', record);

      const updated = { ...record, name: 'Alice Updated', updatedAt: new Date().toISOString() };
      db.upsert('contacts', updated);

      const retrieved = db.get('contacts', record.id) as typeof record;
      expect(retrieved.name).toBe('Alice Updated');
    });

    it('stores records in separate tables', () => {
      const contact = createTestRecord({ name: 'Contact' });
      const interaction = createTestRecord({ name: 'Interaction' });

      db.upsert('contacts', contact);
      db.upsert('interactions', interaction);

      expect(db.get('contacts', contact.id)).toEqual(contact);
      expect(db.get('interactions', interaction.id)).toEqual(interaction);
      expect(db.get('contacts', interaction.id)).toBeNull();
    });

    it('preserves all record fields including nested objects', () => {
      const record = createTestRecord();
      const withNested = {
        ...record,
        metadata: { tags: ['a', 'b'], count: 42 },
        notes: null,
      };

      db.upsert('contacts', withNested);
      const retrieved = db.get('contacts', record.id);

      expect(retrieved).toEqual(withNested);
    });
  });

  describe('getAll', () => {
    it('returns empty array for empty table', () => {
      const result = db.getAll('contacts');
      expect(result).toEqual([]);
    });

    it('returns all records in table', () => {
      const records = [
        createTestRecord({ name: 'Alice' }),
        createTestRecord({ name: 'Bob' }),
        createTestRecord({ name: 'Charlie' }),
      ];

      for (const record of records) {
        db.upsert('contacts', record);
      }

      const result = db.getAll('contacts');
      expect(result).toHaveLength(3);
      expect(result).toEqual(expect.arrayContaining(records));
    });

    it('only returns records from specified table', () => {
      const contact = createTestRecord({ name: 'Contact' });
      const interaction = createTestRecord({ name: 'Interaction' });

      db.upsert('contacts', contact);
      db.upsert('interactions', interaction);

      const contacts = db.getAll('contacts');
      expect(contacts).toHaveLength(1);
      expect(contacts[0]).toEqual(contact);
    });
  });

  describe('remove', () => {
    it('removes a record', () => {
      const record = createTestRecord();
      db.upsert('contacts', record);

      db.remove('contacts', record.id);

      expect(db.get('contacts', record.id)).toBeNull();
    });

    it('does not throw when removing non-existent record', () => {
      expect(() => {
        db.remove('contacts', 'non-existent-id');
      }).not.toThrow();
    });

    it('only removes from specified table', () => {
      const record = createTestRecord();
      db.upsert('contacts', record);
      db.upsert('interactions', record);

      db.remove('contacts', record.id);

      expect(db.get('contacts', record.id)).toBeNull();
      expect(db.get('interactions', record.id)).toEqual(record);
    });
  });

  describe('getLastModified', () => {
    it('returns updatedAt for existing record', () => {
      const updatedAt = '2026-05-07T12:00:00.000Z';
      const record = createTestRecord({ updatedAt });

      db.upsert('contacts', record);

      expect(db.getLastModified('contacts', record.id)).toBe(updatedAt);
    });

    it('returns null for non-existent record', () => {
      expect(db.getLastModified('contacts', 'non-existent-id')).toBeNull();
    });

    it('reflects updated timestamp after upsert', () => {
      const record = createTestRecord({ updatedAt: '2026-05-07T12:00:00.000Z' });
      db.upsert('contacts', record);

      const newUpdatedAt = '2026-05-07T13:00:00.000Z';
      db.upsert('contacts', { ...record, updatedAt: newUpdatedAt });

      expect(db.getLastModified('contacts', record.id)).toBe(newUpdatedAt);
    });
  });

  describe('clear', () => {
    it('removes all records from all tables', () => {
      const contact1 = createTestRecord({ name: 'Contact 1' });
      const contact2 = createTestRecord({ name: 'Contact 2' });
      const interaction = createTestRecord({ name: 'Interaction' });

      db.upsert('contacts', contact1);
      db.upsert('contacts', contact2);
      db.upsert('interactions', interaction);

      db.clear();

      expect(db.getAll('contacts')).toEqual([]);
      expect(db.getAll('interactions')).toEqual([]);
    });

    it('allows new records after clear', () => {
      const record = createTestRecord();
      db.upsert('contacts', record);
      db.clear();

      const newRecord = createTestRecord({ name: 'New Record' });
      db.upsert('contacts', newRecord);

      expect(db.get('contacts', newRecord.id)).toEqual(newRecord);
    });
  });

  describe('close', () => {
    it('closes the database connection', () => {
      db.close();

      // Attempting operations after close should throw
      expect(() => {
        db.get('contacts', 'any-id');
      }).toThrow();
    });
  });

  describe('table name validation', () => {
    it('rejects invalid table names', () => {
      const record = createTestRecord();

      expect(() => db.upsert('invalid-table-name', record)).toThrow('Invalid table name');
      expect(() => db.upsert('table; DROP TABLE users;', record)).toThrow('Invalid table name');
      expect(() => db.upsert('123start', record)).toThrow('Invalid table name');
    });

    it('accepts valid table names', () => {
      const record = createTestRecord();

      expect(() => db.upsert('contacts', record)).not.toThrow();
      expect(() => db.upsert('action_items', record)).not.toThrow();
      expect(() => db.upsert('Contact123', record)).not.toThrow();
      expect(() => db.upsert('_private', record)).not.toThrow();
    });
  });

  describe('corrupted data handling', () => {
    it('throws CacheDataCorruptedError when get() encounters invalid JSON', () => {
      const record = createTestRecord();
      db.upsert('contacts', record);

      // Directly corrupt the data in the database
      const rawDb = new Database(dbPath);
      rawDb.exec(`UPDATE contacts SET data = 'not valid json' WHERE id = '${record.id}'`);
      rawDb.close();

      expect(() => db.get('contacts', record.id)).toThrow(CacheDataCorruptedError);
    });

    it('throws CacheDataCorruptedError when getAll() encounters invalid JSON', () => {
      const record = createTestRecord();
      db.upsert('contacts', record);

      // Directly corrupt the data in the database
      const rawDb = new Database(dbPath);
      rawDb.exec(`UPDATE contacts SET data = '{broken' WHERE id = '${record.id}'`);
      rawDb.close();

      expect(() => db.getAll('contacts')).toThrow(CacheDataCorruptedError);
    });

    it('CacheDataCorruptedError includes table and id', () => {
      const record = createTestRecord();
      db.upsert('contacts', record);

      const rawDb = new Database(dbPath);
      rawDb.exec(`UPDATE contacts SET data = 'bad' WHERE id = '${record.id}'`);
      rawDb.close();

      try {
        db.get('contacts', record.id);
        expect.fail('Should have thrown');
      } catch (err) {
        expect(err).toBeInstanceOf(CacheDataCorruptedError);
        const cacheErr = err as CacheDataCorruptedError;
        expect(cacheErr.table).toBe('contacts');
        expect(cacheErr.id).toBe(record.id);
      }
    });
  });

  describe('clear with unknown tables', () => {
    it('clears tables not accessed through this CacheDb instance', () => {
      // Create a table using raw SQL (simulating a previous run)
      const rawDb = new Database(dbPath);
      rawDb.exec(`
        CREATE TABLE IF NOT EXISTS legacy_table (
          id TEXT PRIMARY KEY,
          data TEXT NOT NULL,
          updated_at TEXT NOT NULL
        )
      `);
      rawDb.exec(`INSERT INTO legacy_table VALUES ('old-id', '{"test": true}', '2026-01-01')`);
      rawDb.close();

      // Our db instance doesn't know about legacy_table
      const record = createTestRecord();
      db.upsert('contacts', record);

      // Clear should wipe both tables
      db.clear();

      // Verify both tables are empty
      expect(db.getAll('contacts')).toEqual([]);

      const checkDb = new Database(dbPath);
      const rows = checkDb.prepare('SELECT * FROM legacy_table').all();
      checkDb.close();
      expect(rows).toEqual([]);
    });
  });

  describe('corrupted database recovery', () => {
    it('recovers from corrupted database file', async () => {
      db.close();

      // Write garbage to the database file
      await writeFile(dbPath, 'this is not a valid sqlite database');

      // Creating a new CacheDb should recover
      const newDb = new CacheDb(dbPath);
      newDb.init();

      // Should work normally
      const record = createTestRecord();
      expect(() => newDb.upsert('contacts', record)).not.toThrow();
      expect(newDb.get('contacts', record.id)).toEqual(record);

      newDb.close();
    });
  });
});
