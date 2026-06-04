import { readFile, readdir, stat } from 'node:fs/promises';
import path from 'node:path';
import type { CacheDb } from './cache-db.js';

export interface IntegrityReport {
  schemaVersionOk: boolean;
  expectedSchemaVersion: number;
  foundSchemaVersion: number | null;
  conflictFiles: string[];
  quarantinedFiles: string[];
  orphanedReferences: string[];
  /**
   * True if stale cache entries were detected. These will be lazily reloaded
   * on next access via FileStore's cache-miss-then-read-disk pattern.
   * IntegrityCheck does NOT actively rebuild the cache.
   */
  cacheRebuilt: boolean;
  errors: string[];
}

export interface IntegrityCheckOptions {
  /** Expected value of the .schema-version file */
  expectedSchemaVersion: number;
  /**
   * Entity directories to scan for cache staleness (e.g., ['contacts', 'interactions']).
   * For Sprint 02, this can be empty since no entities exist yet.
   */
  entityDirectories: string[];
}

// Regex to match iCloud conflict files: "filename 2.json", "filename 3.json", etc.
// Must have a space before the number to distinguish from normal files like "contact-2.json"
const ICLOUD_CONFLICT_PATTERN = / \d+\.json$/;

/**
 * Run integrity checks on the data directory.
 *
 * Checks:
 * 1. .schema-version file exists and matches expected value
 * 2. Scans for iCloud conflict files (reports but doesn't act)
 * 3. Lists quarantined files (reports but doesn't act)
 * 4. Checks for stale cache entries (lazy reload handles refresh)
 *
 * Never throws — all errors are collected in the errors array.
 */
export async function runIntegrityCheck(
  dataPath: string,
  cache: CacheDb,
  options: IntegrityCheckOptions
): Promise<IntegrityReport> {
  const report: IntegrityReport = {
    schemaVersionOk: false,
    expectedSchemaVersion: options.expectedSchemaVersion,
    foundSchemaVersion: null,
    conflictFiles: [],
    quarantinedFiles: [],
    orphanedReferences: [], // Placeholder until Sprint 04 entities exist
    cacheRebuilt: false,
    errors: [],
  };

  // 1. Check .schema-version file
  await checkSchemaVersion(dataPath, options.expectedSchemaVersion, report);

  // 2. Scan for iCloud conflict files
  await scanForConflictFiles(dataPath, report);

  // 3. List quarantined files
  await listQuarantinedFiles(dataPath, report);

  // 4. Check for stale cache entries
  await checkCacheStaleness(dataPath, cache, options.entityDirectories, report);

  return report;
}

/**
 * Check that .schema-version file exists and matches expected value.
 */
async function checkSchemaVersion(
  dataPath: string,
  expectedVersion: number,
  report: IntegrityReport
): Promise<void> {
  const schemaVersionPath = path.join(dataPath, '.schema-version');

  try {
    const content = await readFile(schemaVersionPath, 'utf-8');
    const version = parseInt(content.trim(), 10);

    if (isNaN(version)) {
      report.errors.push(`.schema-version file contains invalid content: "${content.trim()}"`);
      report.foundSchemaVersion = null;
      report.schemaVersionOk = false;
    } else {
      report.foundSchemaVersion = version;
      report.schemaVersionOk = version === expectedVersion;
    }
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      report.errors.push('.schema-version file not found');
    } else {
      report.errors.push(`Error reading .schema-version: ${(err as Error).message}`);
    }
    report.foundSchemaVersion = null;
    report.schemaVersionOk = false;
  }
}

/**
 * Recursively scan dataPath for iCloud conflict files.
 * Pattern: "filename 2.json", "filename 3.json", etc. (space before number)
 */
async function scanForConflictFiles(
  dataPath: string,
  report: IntegrityReport
): Promise<void> {
  try {
    await scanDirectoryForConflicts(dataPath, report);
  } catch (err) {
    report.errors.push(`Error scanning for conflict files: ${(err as Error).message}`);
  }
}

async function scanDirectoryForConflicts(
  dirPath: string,
  report: IntegrityReport
): Promise<void> {
  let entries: string[];
  try {
    entries = await readdir(dirPath);
  } catch {
    // Directory doesn't exist or isn't readable
    return;
  }

  for (const entry of entries) {
    // Skip .quarantine, logs, and hidden directories
    if (entry === '.quarantine' || entry === 'logs' || entry.startsWith('.')) {
      continue;
    }

    const fullPath = path.join(dirPath, entry);

    try {
      const stats = await stat(fullPath);

      if (stats.isDirectory()) {
        await scanDirectoryForConflicts(fullPath, report);
      } else if (stats.isFile() && ICLOUD_CONFLICT_PATTERN.test(entry)) {
        report.conflictFiles.push(fullPath);
      }
    } catch (err) {
      report.errors.push(`Error checking path ${fullPath}: ${(err as Error).message}`);
    }
  }
}

/**
 * List files in the .quarantine directory.
 * Prints warning to stderr for each quarantined file found.
 */
async function listQuarantinedFiles(
  dataPath: string,
  report: IntegrityReport
): Promise<void> {
  const quarantinePath = path.join(dataPath, '.quarantine');

  try {
    const entries = await readdir(quarantinePath);

    for (const entry of entries) {
      const fullPath = path.join(quarantinePath, entry);
      report.quarantinedFiles.push(fullPath);

      // Print loud warning to stderr (independent of LOG_LEVEL)
      console.error(`⚠️  QUARANTINED (existing): ${fullPath}`);
    }
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
      // ENOENT is expected if .quarantine doesn't exist yet
      report.errors.push(`Error reading .quarantine directory: ${(err as Error).message}`);
    }
  }
}

/**
 * Check for stale cache entries in entity directories.
 * Sets cacheRebuilt: true if any stale entries are detected.
 * Does NOT actively rebuild — FileStore handles lazy reload on cache miss.
 */
async function checkCacheStaleness(
  dataPath: string,
  cache: CacheDb,
  entityDirectories: string[],
  report: IntegrityReport
): Promise<void> {
  let staleCount = 0;

  for (const entityDir of entityDirectories) {
    const dirPath = path.join(dataPath, entityDir);
    const tableName = entityDir; // Table name matches directory name

    try {
      const entries = await readdir(dirPath);

      for (const entry of entries) {
        // Only check .json files, skip temp files
        if (!entry.endsWith('.json') || entry.includes('.tmp.')) {
          continue;
        }

        const fullPath = path.join(dirPath, entry);

        try {
          // Extract ID from filename (assumes UUID is in filename)
          const idMatch = entry.match(
            /([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i
          );
          if (!idMatch) {
            continue; // Can't determine ID, skip
          }
          const id = idMatch[1];

          // Get file modification time
          const stats = await stat(fullPath);
          const fileMtime = stats.mtime;

          // Get cache entry's last modified time
          const cacheLastModified = cache.getLastModified(tableName, id);

          if (cacheLastModified === null) {
            // Cache entry missing
            staleCount++;
          } else {
            // Compare file mtime to cache timestamp
            // Note: in rare cases, same-second writes can produce false staleness due to clock asymmetry
            // between filesystem mtime and JavaScript Date. The staleness is harmless (cache rebuild
            // is a no-op when entries are actually up to date), but worth knowing if false 'cacheRebuilt'
            // warnings appear frequently in production.
            const cacheTime = new Date(cacheLastModified);
            if (fileMtime > cacheTime) {
              staleCount++;
            }
          }
        } catch (err) {
          report.errors.push(`Error checking cache staleness for ${fullPath}: ${(err as Error).message}`);
        }
      }
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
        // ENOENT is expected if entity directory doesn't exist yet
        report.errors.push(`Error reading entity directory ${entityDir}: ${(err as Error).message}`);
      }
    }
  }

  report.cacheRebuilt = staleCount > 0;
}
