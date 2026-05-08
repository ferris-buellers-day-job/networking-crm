import Database from 'better-sqlite3';
import type { Database as DatabaseType } from 'better-sqlite3';
import type { BaseRecord } from './schemas/base-record.js';

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

  constructor(dbPath: string) {
    this.db = new Database(dbPath);
    // Enable WAL mode for better concurrent read performance
    this.db.pragma('journal_mode = WAL');
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

    return JSON.parse(row.data);
  }

  /**
   * Get all records from a table.
   * Returns parsed records.
   */
  getAll(table: string): unknown[] {
    this.ensureTable(table);

    const stmt = this.db.prepare(`
      SELECT data FROM "${table}"
    `);

    const rows = stmt.all() as { data: string }[];
    return rows.map((row) => JSON.parse(row.data));
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
   * Clear all data from all known tables.
   * Used for full cache rebuild.
   */
  clear(): void {
    for (const table of this.knownTables) {
      this.db.exec(`DELETE FROM "${table}"`);
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
