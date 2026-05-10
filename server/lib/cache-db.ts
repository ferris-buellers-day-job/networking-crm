import Database from 'better-sqlite3';
import type { Database as DatabaseType } from 'better-sqlite3';
import { unlinkSync, existsSync } from 'node:fs';
import type { BaseRecord } from './schemas/base-record.js';

/**
 * Error thrown when cached data cannot be parsed.
 * Indicates the cache is corrupted and should be rebuilt.
 */
export class CacheDataCorruptedError extends Error {
  constructor(
    public readonly table: string,
    public readonly id: string,
    public readonly cause: Error
  ) {
    super(`Corrupted cache data in table "${table}" for id "${id}": ${cause.message}`);
    this.name = 'CacheDataCorruptedError';
  }
}

/**
 * SQLite cache layer for fast querying of JSON file data.
 *
 * The cache is always disposable and rebuildable from JSON files.
 * Each entity type gets its own table, created on-demand.
 *
 * Schema per table:
 * - id TEXT PRIMARY KEY
 * - data TEXT (JSON blob of full record)
 * - updated_at TEXT (for staleness checks)
 */
export class CacheDb {
  private db: DatabaseType;
  private knownTables: Set<string> = new Set();
  private dbPath: string;

  constructor(dbPath: string) {
    this.dbPath = dbPath;
    this.db = this.openDatabase();
  }

  /**
   * Opens the database, handling corruption by deleting and recreating.
   */
  private openDatabase(): DatabaseType {
    try {
      const db = new Database(this.dbPath);
      // Enable WAL mode for better concurrent read performance
      db.pragma('journal_mode = WAL');
      // Validate database integrity. Returns 'ok' if healthy, or error descriptions.
      // We check explicitly because pragma() doesn't throw on integrity failures.
      const result = db.pragma('integrity_check') as { integrity_check: string }[];
      if (result[0]?.integrity_check !== 'ok') {
        throw new Error('Database integrity check failed');
      }
      return db;
    } catch (err) {
      // Database is corrupted - delete and recreate
      if (existsSync(this.dbPath)) {
        unlinkSync(this.dbPath);
      }
      // Also clean up WAL and SHM files if they exist
      const walPath = `${this.dbPath}-wal`;
      const shmPath = `${this.dbPath}-shm`;
      if (existsSync(walPath)) {
        unlinkSync(walPath);
      }
      if (existsSync(shmPath)) {
        unlinkSync(shmPath);
      }

      // Create fresh database
      const db = new Database(this.dbPath);
      db.pragma('journal_mode = WAL');
      return db;
    }
  }

  /**
   * Initialize the database. Currently a no-op since tables are created on-demand.
   * Called at startup to ensure the database file is valid.
   */
  init(): void {
    // Tables are created on-demand in ensureTable()
    // This method exists for explicit initialization at startup
  }

  /**
   * Ensure a table exists for the given entity type.
   * Tables are created lazily on first upsert.
   */
  private ensureTable(table: string): void {
    if (this.knownTables.has(table)) {
      return;
    }

    // Validate table name to prevent SQL injection
    if (!/^[a-z_][a-z0-9_]*$/i.test(table)) {
      throw new Error(`Invalid table name: ${table}`);
    }

    this.db.exec(`
      CREATE TABLE IF NOT EXISTS "${table}" (
        id TEXT PRIMARY KEY,
        data TEXT NOT NULL,
        updated_at TEXT NOT NULL
      )
    `);

    this.knownTables.add(table);
  }

  /**
   * Insert or update a record in the cache.
   */
  upsert(table: string, record: BaseRecord & Record<string, unknown>): void {
    this.ensureTable(table);

    const stmt = this.db.prepare(`
      INSERT OR REPLACE INTO "${table}" (id, data, updated_at)
      VALUES (?, ?, ?)
    `);

    stmt.run(record.id, JSON.stringify(record), record.updatedAt);
  }

  /**
   * Get a single record by ID.
   * Returns the parsed record or null if not found.
   * @throws {CacheDataCorruptedError} if the stored JSON is invalid
   */
  get(table: string, id: string): unknown | null {
    this.ensureTable(table);

    const stmt = this.db.prepare(`
      SELECT data FROM "${table}" WHERE id = ?
    `);

    const row = stmt.get(id) as { data: string } | undefined;
    if (!row) {
      return null;
    }

    try {
      return JSON.parse(row.data);
    } catch (err) {
      throw new CacheDataCorruptedError(table, id, err as Error);
    }
  }

  /**
   * Get all records from a table.
   * Returns parsed records.
   * @throws {CacheDataCorruptedError} if any stored JSON is invalid
   */
  getAll(table: string): unknown[] {
    this.ensureTable(table);

    const stmt = this.db.prepare(`
      SELECT id, data FROM "${table}"
    `);

    const rows = stmt.all() as { id: string; data: string }[];
    return rows.map((row) => {
      try {
        return JSON.parse(row.data);
      } catch (err) {
        throw new CacheDataCorruptedError(table, row.id, err as Error);
      }
    });
  }

  /**
   * Remove a record from the cache.
   */
  remove(table: string, id: string): void {
    this.ensureTable(table);

    const stmt = this.db.prepare(`
      DELETE FROM "${table}" WHERE id = ?
    `);

    stmt.run(id);
  }

  /**
   * Get the updatedAt timestamp for a record.
   * Used for staleness checks during cache rebuild.
   */
  getLastModified(table: string, id: string): string | null {
    this.ensureTable(table);

    const stmt = this.db.prepare(`
      SELECT updated_at FROM "${table}" WHERE id = ?
    `);

    const row = stmt.get(id) as { updated_at: string } | undefined;
    return row?.updated_at ?? null;
  }

  /**
   * Clear all data from all tables in the database.
   * Used for full cache rebuild.
   */
  clear(): void {
    // Query sqlite_master for all user tables (not sqlite_ internal tables)
    const tables = this.db
      .prepare(`SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'`)
      .all() as { name: string }[];

    for (const { name } of tables) {
      this.db.exec(`DELETE FROM "${name}"`);
      this.knownTables.add(name);
    }
  }

  /**
   * Close the database connection.
   * Should be called on app shutdown.
   */
  close(): void {
    this.db.close();
  }
}
