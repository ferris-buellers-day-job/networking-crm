import { mkdir, writeFile, access } from 'node:fs/promises';
import path from 'node:path';
import { createLogger, type Logger } from '../lib/logger.js';
import { createRecentWrites, type RecentWrites } from '../lib/recent-writes.js';
import { CacheDb } from '../lib/cache-db.js';
import { FileWatcher, type FileWatcherEvent } from '../lib/file-watcher.js';
import { BackupService } from '../lib/backup-service.js';
import { runIntegrityCheck, type IntegrityReport } from '../lib/integrity-check.js';
import { FileStore } from '../lib/file-store.js';
import { ContactSchema, CONTACT_SCHEMA_VERSION, type Contact } from '../schemas/contact.js';
import { InteractionSchema, INTERACTION_SCHEMA_VERSION, type Interaction } from '../schemas/interaction.js';
import { InboxEntrySchema, INBOX_ENTRY_SCHEMA_VERSION, type InboxEntry } from '../schemas/inbox-entry.js';

/**
 * Error thrown when storage initialization fails fatally.
 * The caller should catch this and call process.exit(err.exitCode).
 */
export class FatalStorageError extends Error {
  constructor(
    message: string,
    public readonly exitCode: number
  ) {
    super(message);
    this.name = 'FatalStorageError';
  }
}

export interface StorageConfig {
  dataPath: string;
  cacheDbPath: string;
  backupPath: string;
  logRetentionDays?: number;
}

export interface StorageContext {
  logger: Logger;
  recentWrites: RecentWrites;
  cacheDb: CacheDb;
  fileWatcher: FileWatcher;
  backupService: BackupService;
  integrityReport: IntegrityReport;
  integrityCheckedAt: string;
  contactsStore: FileStore<Contact>;
  interactionsStore: FileStore<Interaction>;
  inboxEntryStore: FileStore<InboxEntry>;

  /** Start file watcher and backup scheduler */
  start(): void;
  /** Stop watcher, scheduler, close DB. Returns when cleanup complete. */
  stop(): Promise<void>;
}

// UUID pattern for extracting ID from filenames
const UUID_PATTERN = /([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i;

// Expected schema version for Sprint 02
// Sprint 04: this will be replaced by per-entity schema versions from each entity's schema module.
const EXPECTED_SCHEMA_VERSION = 1;

// Entity directories to check for cache staleness
const ENTITY_DIRECTORIES: string[] = ['contacts', 'interactions', 'inbox_queue'];

/**
 * Initialize the storage layer.
 *
 * Creates all foundation components in the correct order:
 * 1. Logger and RecentWrites (shared instances)
 * 2. Data directory structure
 * 3. CacheDb
 * 4. Integrity check (fatal if .schema-version missing/mismatched)
 * 5. FileWatcher (not started)
 * 6. BackupService (not started)
 *
 * @throws Error with exit code 2 for fatal integrity issues
 */
export async function initStorage(config: StorageConfig): Promise<StorageContext> {
  // 1. Create shared instances
  const logDir = path.join(config.dataPath, 'logs');
  const logger = createLogger(logDir, {
    retentionDays: config.logRetentionDays,
  });
  const recentWrites = createRecentWrites();

  logger.info('storage.init', 'Initializing storage layer', {
    dataPath: config.dataPath,
    cacheDbPath: config.cacheDbPath,
    backupPath: config.backupPath,
  });

  // 2. Initialize data directory structure (inbox_queue dir created inside)
  try {
    await initDataDirectory(config.dataPath);
  } catch (err) {
    const message = `Fatal: Failed to initialize data directory: ${(err as Error).message}`;
    logger.error('storage.init', message);
    throw new FatalStorageError(message, 1);
  }

  // 3. Initialize cache DB
  let cacheDb: CacheDb;
  try {
    // Ensure cache DB parent directory exists
    const cacheDbDir = path.dirname(config.cacheDbPath);
    await mkdir(cacheDbDir, { recursive: true });

    cacheDb = new CacheDb(config.cacheDbPath);
    cacheDb.init();
  } catch (err) {
    const message = `Fatal: Failed to initialize cache database: ${(err as Error).message}`;
    logger.error('storage.init', message);
    throw new FatalStorageError(message, 1);
  }

  // 4. Run integrity check
  const integrityCheckedAt = new Date().toISOString();
  const integrityReport = await runIntegrityCheck(config.dataPath, cacheDb, {
    expectedSchemaVersion: EXPECTED_SCHEMA_VERSION,
    entityDirectories: ENTITY_DIRECTORIES,
  });

  // Check for fatal integrity issues
  if (!integrityReport.schemaVersionOk) {
    const reasons: string[] = [];
    if (integrityReport.foundSchemaVersion === null) {
      reasons.push('.schema-version file missing or unreadable');
    } else {
      reasons.push(
        `Schema version mismatch: expected ${integrityReport.expectedSchemaVersion}, found ${integrityReport.foundSchemaVersion}`
      );
    }
    if (integrityReport.errors.length > 0) {
      reasons.push(`Errors: ${integrityReport.errors.join('; ')}`);
    }

    const message = `Fatal: Integrity check failed — ${reasons.join('. ')}`;
    logger.error('storage.integrityFatal', message, { report: integrityReport });
    throw new FatalStorageError(message, 2);
  }

  // Log warnings for non-fatal issues
  if (integrityReport.conflictFiles.length > 0) {
    logger.warn('storage.integrityWarning', 'iCloud conflict files detected', {
      count: integrityReport.conflictFiles.length,
      files: integrityReport.conflictFiles,
    });
    console.error(`⚠️  Warning: ${integrityReport.conflictFiles.length} iCloud conflict file(s) detected`);
  }

  if (integrityReport.quarantinedFiles.length > 0) {
    logger.warn('storage.integrityWarning', 'Quarantined files found', {
      count: integrityReport.quarantinedFiles.length,
    });
    // Note: IntegrityCheck already printed individual quarantine warnings to stderr
  }

  if (integrityReport.cacheRebuilt) {
    logger.info('storage.cacheStale', 'Stale cache entries detected, will be lazily reloaded');
  }

  if (integrityReport.errors.length > 0) {
    logger.warn('storage.integrityWarning', 'Errors during integrity check', {
      errors: integrityReport.errors,
    });
  }

  // 5. Create FileWatcher (not started yet)
  const fileWatcher = new FileWatcher(
    config.dataPath,
    { recentWrites, logger },
    {
      onFileChange: async (absolutePath: string, event: FileWatcherEvent) => {
        invalidateCache(absolutePath, event, config.dataPath, cacheDb, logger);
      },
      onError: (err: Error) => {
        logger.error('storage.watcherError', 'File watcher error', { error: err.message });
      },
    }
  );

  // 6. Create BackupService (not started yet)
  const backupService = new BackupService(config.dataPath, config.backupPath, { logger });

  // 7. Create entity FileStores
  const contactsStore = new FileStore<Contact>(
    path.join(config.dataPath, 'contacts'),
    ContactSchema,
    { cacheDb, logger, recentWrites },
    { expectedSchemaVersion: CONTACT_SCHEMA_VERSION }
  );

  const interactionsStore = new FileStore<Interaction>(
    path.join(config.dataPath, 'interactions'),
    InteractionSchema,
    { cacheDb, logger, recentWrites },
    { expectedSchemaVersion: INTERACTION_SCHEMA_VERSION }
  );

  const inboxEntryStore = new FileStore<InboxEntry>(
    path.join(config.dataPath, 'inbox_queue'),
    InboxEntrySchema,
    { cacheDb, logger, recentWrites },
    { expectedSchemaVersion: INBOX_ENTRY_SCHEMA_VERSION }
  );

  logger.info('storage.init', 'Storage layer initialized successfully');

  // Build context with start/stop methods
  let isStarted = false;
  let isStopping = false;

  return {
    logger,
    recentWrites,
    cacheDb,
    fileWatcher,
    backupService,
    integrityReport,
    integrityCheckedAt,
    contactsStore,
    interactionsStore,
    inboxEntryStore,

    start(): void {
      if (isStarted) return;
      isStarted = true;

      fileWatcher.start();
      backupService.startScheduler();

      logger.info('storage.started', 'Storage layer started (watcher and scheduler running)');
    },

    async stop(): Promise<void> {
      if (isStopping) return;
      isStopping = true;

      logger.info('storage.stopping', 'Stopping storage layer...');

      // 1. Stop file watcher (drains pending events)
      await fileWatcher.stop();
      logger.debug('storage.stopping', 'File watcher stopped');

      // 2. Stop backup scheduler (let in-flight backup finish)
      backupService.stopScheduler();
      logger.debug('storage.stopping', 'Backup scheduler stopped');

      // 3. Close cache DB
      cacheDb.close();
      logger.debug('storage.stopping', 'Cache DB closed');

      // 4. Logger doesn't need explicit close (sync writes)

      logger.info('storage.stopped', 'Storage layer stopped');
    },
  };
}

/**
 * Initialize the data directory structure.
 * Creates required directories and .schema-version file if missing.
 */
async function initDataDirectory(dataPath: string): Promise<void> {
  // Create directory structure
  const dirs = [
    dataPath,
    path.join(dataPath, 'contacts'),
    path.join(dataPath, 'interactions'),
    path.join(dataPath, 'inbox_queue'),
    path.join(dataPath, 'logs'),
    path.join(dataPath, '.quarantine'),
  ];

  for (const dir of dirs) {
    await mkdir(dir, { recursive: true });
  }

  // Create .schema-version file if it doesn't exist
  const schemaVersionPath = path.join(dataPath, '.schema-version');
  try {
    await access(schemaVersionPath);
  } catch {
    // File doesn't exist, create it
    await writeFile(schemaVersionPath, String(EXPECTED_SCHEMA_VERSION));
  }
}

/**
 * Invalidate cache entry for a changed file.
 * Parses the file path to extract table name and ID.
 * Logs warning and skips if path doesn't match expected pattern.
 */
function invalidateCache(
  absolutePath: string,
  event: FileWatcherEvent,
  dataPath: string,
  cacheDb: CacheDb,
  logger: Logger
): void {
  // Get path relative to dataPath
  const relativePath = path.relative(dataPath, absolutePath);
  const parts = relativePath.split(path.sep);

  // Expected pattern: <table>/<uuid>.json (e.g., contacts/abc-123.json)
  // Must be exactly 2 parts: directory and filename
  if (parts.length !== 2) {
    logger.warn('storage.cacheInvalidate', 'Skipping cache invalidation for nested/unexpected path', {
      path: absolutePath,
      event,
    });
    return;
  }

  const [tableName, filename] = parts;

  // Extract UUID from filename
  const uuidMatch = filename.match(UUID_PATTERN);
  if (!uuidMatch) {
    logger.warn('storage.cacheInvalidate', 'Skipping cache invalidation - no UUID in filename', {
      path: absolutePath,
      event,
    });
    return;
  }

  const id = uuidMatch[1];

  // Invalidate the cache entry
  cacheDb.remove(tableName, id);

  logger.debug('storage.cacheInvalidate', 'Invalidated cache entry', {
    table: tableName,
    id,
    event,
  });
}
