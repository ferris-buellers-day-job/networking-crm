import { readFile, readdir, rename, mkdir } from 'node:fs/promises';
import path from 'node:path';
import type { ZodType, ZodError } from 'zod';
import { atomicWriteJson } from './atomic-writer.js';
import type { CacheDb } from './cache-db.js';
import { StorageError } from './errors.js';
import type { Logger } from './logger.js';
import type { RecentWrites } from './recent-writes.js';
import type { BaseRecord } from './schemas/base-record.js';

/**
 * Migration function type. Transforms a record from one schema version to the next.
 * Receives and returns Record<string, unknown> — not the typed entity — because
 * old-version records don't conform to the current Zod schema.
 * Must be synchronous. Must NOT set schemaVersion; FileStore auto-bumps it.
 * Must NOT modify createdAt or updatedAt; FileStore force-restores them after the chain.
 */
export type MigrationFn = (record: Record<string, unknown>) => Record<string, unknown>;

/**
 * Error thrown when validation fails before writing to disk.
 * The invalid data never reaches disk.
 */
export class FileStoreValidationError extends Error {
  constructor(
    public readonly zodError: ZodError,
    message?: string
  ) {
    super(message ?? `Validation failed: ${zodError.message}`);
    this.name = 'FileStoreValidationError';
  }
}

/**
 * Error thrown when a file is quarantined due to validation failure on read.
 * The file has been moved to .quarantine/ and removed from cache.
 */
export class FileStoreQuarantineError extends Error {
  constructor(
    public readonly originalPath: string,
    public readonly quarantinePath: string,
    public readonly reason: string
  ) {
    super(`File quarantined: ${originalPath} — ${reason}`);
    this.name = 'FileStoreQuarantineError';
  }
}

export interface FileStoreDeps {
  cacheDb: CacheDb;
  logger: Logger;
  recentWrites: RecentWrites;
}

export interface FileStoreOptions<T> {
  /** Custom filename pattern. Default: `<id>.json` */
  filenamePattern?: (record: T) => string;
  /** Expected schema version. Files with higher versions are quarantined; lower versions are migrated. */
  expectedSchemaVersion: number;
  /**
   * Migration functions keyed by fromVersion (e.g. { 1: v1ToV2, 2: v2ToV3 }).
   * Absence or empty map means no migrations are registered.
   * Functions are synchronous; FileStore auto-bumps schemaVersion after each step.
   */
  migrations?: Record<number, MigrationFn>;
}

export interface GetOptions {
  /** Bypass cache and read directly from disk */
  forceReload?: boolean;
}

export interface GetAllOptions {
  /** Include soft-deleted records */
  includeDeleted?: boolean;
}

export interface SaveOptions {
  /** Preserve caller's createdAt and updatedAt instead of auto-setting */
  preserveTimestamps?: boolean;
}

/**
 * Generic file store for JSON records with Zod validation.
 *
 * Provides async CRUD over JSON files by UUID with:
 * - Atomic writes via AtomicWriter
 * - SQLite cache for fast reads
 * - Zod schema validation on read and write
 * - Automatic quarantine of invalid files
 * - Schema version checking
 */
export class FileStore<T extends BaseRecord> {
  private readonly folder: string;
  private readonly schema: ZodType<T>;
  private readonly cacheDb: CacheDb;
  private readonly logger: Logger;
  private readonly recentWrites: RecentWrites;
  private readonly tableName: string;
  private readonly expectedSchemaVersion: number;
  private readonly filenamePattern: (record: T) => string;
  private readonly quarantineDir: string;
  private readonly migrations: Record<number, MigrationFn>;

  constructor(
    folder: string,
    schema: ZodType<T>,
    deps: FileStoreDeps,
    options: FileStoreOptions<T>
  ) {
    this.folder = folder;
    this.schema = schema;
    this.cacheDb = deps.cacheDb;
    this.logger = deps.logger;
    this.recentWrites = deps.recentWrites;
    this.expectedSchemaVersion = options.expectedSchemaVersion;
    this.filenamePattern = options.filenamePattern ?? ((record: T) => `${record.id}.json`);
    this.migrations = options.migrations ?? {};

    // Derive table name from folder basename
    this.tableName = path.basename(folder);

    // Quarantine directory is sibling to the entity folder
    this.quarantineDir = path.join(path.dirname(folder), '.quarantine');
  }

  /**
   * Check if a record exists by ID.
   * Does not validate or touch the cache.
   */
  async exists(id: string): Promise<boolean> {
    const filePath = await this.findFileById(id);
    return filePath !== null;
  }

  /**
   * Get a record by ID.
   *
   * @param id - Record UUID
   * @param options - Optional settings (forceReload to bypass cache)
   * @returns The record, or null if not found
   * @throws {FileStoreQuarantineError} if validation fails (file is quarantined)
   */
  async get(id: string, options: GetOptions = {}): Promise<T | null> {
    // Check cache first unless forceReload
    if (!options.forceReload) {
      const cached = this.cacheDb.get(this.tableName, id) as T | null;
      if (cached !== null) {
        return cached;
      }
    }

    // Find file on disk
    const filePath = await this.findFileById(id);
    if (filePath === null) {
      return null;
    }

    // Read from disk, validate, update cache
    return this.readAndValidate(filePath);
  }

  /**
   * Get all records.
   *
   * @param options - Optional settings (includeDeleted to include soft-deleted records)
   * @returns Array of records
   */
  async getAll(options: GetAllOptions = {}): Promise<T[]> {
    const files = await this.listJsonFiles();
    const records: T[] = [];

    for (const filename of files) {
      const filePath = path.join(this.folder, filename);
      try {
        const record = await this.readAndValidate(filePath);
        if (record !== null) {
          // Filter soft-deleted unless includeDeleted
          if (options.includeDeleted || record.deletedAt === null) {
            records.push(record);
          }
        }
      } catch (err) {
        if (err instanceof FileStoreQuarantineError) {
          // Log but continue processing other files
          this.logger.warn('fileStore.getAll', `Skipping quarantined file: ${filename}`, {
            reason: err.reason,
          });
        } else {
          throw err;
        }
      }
    }

    return records;
  }

  /**
   * Save a record.
   *
   * @param record - Record to save
   * @param options - Optional settings (preserveTimestamps to keep caller's timestamps)
   * @throws {FileStoreValidationError} if validation fails (file is never written)
   */
  async save(record: T, options: SaveOptions = {}): Promise<void> {
    const now = new Date().toISOString();
    let recordToSave = { ...record };

    if (!options.preserveTimestamps) {
      // Check if file exists to determine if this is a new record
      const existingPath = await this.findFileById(record.id);
      if (existingPath === null) {
        // New record: set createdAt
        recordToSave = { ...recordToSave, createdAt: now };
      }
      // Always set updatedAt
      recordToSave = { ...recordToSave, updatedAt: now };
    }

    // Validate before writing
    const parseResult = this.schema.safeParse(recordToSave);
    if (!parseResult.success) {
      throw new FileStoreValidationError(parseResult.error);
    }

    // Generate filename and write atomically
    const filename = this.filenamePattern(recordToSave as T);
    const filePath = path.join(this.folder, filename);

    await atomicWriteJson(filePath, recordToSave, this.recentWrites);

    // Update cache eagerly
    this.cacheDb.upsert(this.tableName, recordToSave as T & Record<string, unknown>);

    this.logger.info('fileStore.save', `Saved record`, {
      id: record.id,
      table: this.tableName,
    });
  }

  /**
   * Soft-delete a record by setting deletedAt.
   * Idempotent: calling delete on an already-deleted record is a no-op.
   *
   * @param id - Record UUID
   * @throws {FileStoreQuarantineError} if the record can't be read
   */
  async delete(id: string): Promise<void> {
    // Use forceReload to operate on authoritative disk state, not stale cache
    const record = await this.get(id, { forceReload: true });
    if (record === null) {
      this.logger.warn('fileStore.delete', `Record not found for deletion`, { id });
      return;
    }

    // Idempotent: preserve original deletion timestamp
    if (record.deletedAt !== null) {
      this.logger.warn('fileStore.delete', `Delete called on already-deleted record`, {
        id,
        deletedAt: record.deletedAt,
      });
      return;
    }

    const deletedRecord = { ...record, deletedAt: new Date().toISOString() };
    await this.save(deletedRecord, { preserveTimestamps: true });

    this.logger.info('fileStore.delete', `Soft-deleted record`, {
      id,
      table: this.tableName,
    });
  }

  /**
   * Read a file from disk, validate it, and update the cache.
   * On validation failure, quarantines the file.
   */
  private async readAndValidate(filePath: string): Promise<T> {
    let rawData: string;
    try {
      rawData = await readFile(filePath, 'utf-8');
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
        // File disappeared between listing and reading
        return null as unknown as T;
      }
      throw err;
    }

    // Parse JSON
    let parsed: unknown;
    try {
      parsed = JSON.parse(rawData);
    } catch {
      await this.quarantine(filePath, 'Invalid JSON');
      throw new FileStoreQuarantineError(
        filePath,
        await this.getQuarantinePath(filePath),
        'Invalid JSON'
      );
    }

    // Check schema version before full validation
    const schemaVersion = (parsed as Record<string, unknown>).schemaVersion;
    if (typeof schemaVersion === 'number') {
      if (schemaVersion > this.expectedSchemaVersion) {
        const reason = `schema version too high (found ${schemaVersion}, expected ${this.expectedSchemaVersion}) — file may be from a newer app version`;
        await this.quarantine(filePath, reason);
        throw new FileStoreQuarantineError(
          filePath,
          await this.getQuarantinePath(filePath),
          reason
        );
      }

      if (schemaVersion < this.expectedSchemaVersion) {
        // MIGRATION PATH — see ADR 018
        const onDiskVersion = schemaVersion;

        // Capture original timestamps before the chain loop mutates `current`.
        // Force-restored after the loop, before Zod validation — so restoration
        // is what's validated and written (validate-what-you-write invariant).
        const originalCreatedAt = (parsed as Record<string, unknown>).createdAt;
        const originalUpdatedAt = (parsed as Record<string, unknown>).updatedAt;

        let current: Record<string, unknown> = parsed as Record<string, unknown>;

        for (let v = onDiskVersion; v < this.expectedSchemaVersion; v++) {
          const migrateFn = this.migrations[v];

          if (!migrateFn) {
            const reason = `no migration function registered for v${v}→v${v + 1}`;
            await this.quarantine(filePath, reason);
            throw new FileStoreQuarantineError(
              filePath,
              await this.getQuarantinePath(filePath),
              reason
            );
          }

          try {
            current = migrateFn(current);
          } catch (err) {
            const reason = `Migration v${v}→v${v + 1} threw: ${(err as Error).message}`;
            await this.quarantine(filePath, reason);
            throw new FileStoreQuarantineError(
              filePath,
              await this.getQuarantinePath(filePath),
              reason
            );
          }

          // Auto-bump after migration fn output — overwrites any schemaVersion the fn returned
          current = { ...current, schemaVersion: v + 1 };
        }

        // Restore original timestamps — before Zod validation so restored values
        // are what gets validated and subsequently written to disk.
        current = {
          ...current,
          createdAt: originalCreatedAt,
          updatedAt: originalUpdatedAt,
        };

        // Validate migrated record against the current Zod schema
        const migratedParseResult = this.schema.safeParse(current);
        if (!migratedParseResult.success) {
          const reason = `migration v${onDiskVersion}→v${this.expectedSchemaVersion} produced a record that fails current-schema validation: ${migratedParseResult.error.message}`;
          await this.quarantine(filePath, reason);
          throw new FileStoreQuarantineError(
            filePath,
            await this.getQuarantinePath(filePath),
            reason
          );
        }

        const migratedRecord = migratedParseResult.data;

        // Eager write-back — atomicWriteJson directly to original filePath, not via save().
        // save() would re-derive the filename (directory scan + filenamePattern) and
        // double-validate. Passing this.recentWrites registers the write with chokidar
        // so the file watcher does not treat it as an external edit.
        try {
          await atomicWriteJson(filePath, migratedRecord, this.recentWrites);
        } catch (err) {
          // Bad disk, not bad data — do NOT quarantine. The original file is still intact
          // at filePath (atomic write either renamed fully or cleaned up its .tmp).
          // The caller can retry get() to re-run the migration chain.
          // Note: StorageError.recoverable is false (class-level constant) but this failure
          // is operationally retryable — .recoverable is currently dormant in this codebase.
          throw new StorageError(
            `Migration write-back failed: ${(err as Error).message}`,
            { op: 'fileStore.migrate', context: { filePath }, cause: err instanceof Error ? err : undefined }
          );
        }

        // Cache updated only after successful write-back; if write-back threw above,
        // cache remains empty for this id (migration ran on a cache miss).
        this.cacheDb.upsert(this.tableName, migratedRecord as T & Record<string, unknown>);

        this.logger.info('fileStore.migrate', 'Migrated record', {
          id: (migratedRecord as Record<string, unknown>).id,
          table: this.tableName,
          fromVersion: onDiskVersion,
          toVersion: this.expectedSchemaVersion,
        });

        return migratedRecord;
      }
    }

    // Validate against Zod schema
    const parseResult = this.schema.safeParse(parsed);
    if (!parseResult.success) {
      const reason = `Zod validation failed: ${parseResult.error.message}`;
      await this.quarantine(filePath, reason);
      throw new FileStoreQuarantineError(
        filePath,
        await this.getQuarantinePath(filePath),
        reason
      );
    }

    const record = parseResult.data;

    // Update cache
    this.cacheDb.upsert(this.tableName, record as T & Record<string, unknown>);

    return record;
  }

  /**
   * Move a file to quarantine and remove from cache.
   */
  private async quarantine(filePath: string, reason: string): Promise<void> {
    // Remove from cache
    const filename = path.basename(filePath);
    // Extract ID from filename (assumes pattern includes ID)
    const idMatch = filename.match(/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i);
    if (idMatch) {
      this.cacheDb.remove(this.tableName, idMatch[1]);
    }

    // Ensure quarantine directory exists
    await mkdir(this.quarantineDir, { recursive: true });

    // Generate quarantine path with timestamp
    const quarantinePath = await this.getQuarantinePath(filePath);

    // Move file to quarantine
    try {
      await rename(filePath, quarantinePath);
    } catch (err) {
      this.logger.error('fileStore.quarantine', `Failed to move file to quarantine`, {
        filePath,
        quarantinePath,
        error: (err as Error).message,
      });
      throw err;
    }

    // Log at error level
    this.logger.error('fileStore.quarantine', `Quarantined file`, {
      originalPath: filePath,
      quarantinePath,
      reason,
    });

    // Print loud warning to stderr (independent of LOG_LEVEL)
    console.error(`⚠️  QUARANTINED: ${filePath} — ${reason}`);
  }

  /**
   * Generate the quarantine path for a file.
   * Pattern: .quarantine/<filename>.<ISO-timestamp>.quarantined
   * Colons in timestamp are replaced with hyphens for filesystem compatibility.
   */
  private async getQuarantinePath(filePath: string): Promise<string> {
    const filename = path.basename(filePath);
    const timestamp = new Date().toISOString().replace(/:/g, '-');
    return path.join(this.quarantineDir, `${filename}.${timestamp}.quarantined`);
  }

  /**
   * Find a file by record ID.
   * Scans the folder for a file containing the ID.
   *
   * TODO: substring match on id is technically loose (e.g., a file named
   * "abc-<uuid>-def.json" would match). Consider exact-match within filename
   * pattern in future hardening, or validate that matched filename produces
   * the same id when parsed.
   */
  private async findFileById(id: string): Promise<string | null> {
    try {
      const files = await this.listJsonFiles();
      for (const filename of files) {
        if (filename.includes(id)) {
          return path.join(this.folder, filename);
        }
      }
      return null;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
        return null;
      }
      throw err;
    }
  }

  /**
   * List all JSON files in the folder.
   */
  private async listJsonFiles(): Promise<string[]> {
    try {
      const entries = await readdir(this.folder);
      return entries.filter((f) => f.endsWith('.json') && !f.includes('.tmp.'));
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
        return [];
      }
      throw err;
    }
  }
}
