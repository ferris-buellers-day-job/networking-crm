# Sprint 02 — Acceptance Criteria

Check each box when met. Claude Code should update this file as items complete.

## Dependencies
- [ ] `better-sqlite3` installed and working.
- [ ] `@types/better-sqlite3` installed.
- [ ] `chokidar` installed.
- [ ] `zod` (3.23+) installed.
- [ ] `vitest` installed as dev dependency.
- [ ] `npm install` completes without errors.
- [ ] `npm run typecheck` passes.

## Environment
- [ ] `.env.example` updated with `DATA_PATH`, `CACHE_DB_PATH`, `BACKUP_PATH`, `LOG_LEVEL`, `LOG_RETENTION_DAYS`.
- [ ] `.gitignore` updated to exclude `data/`, `*.db`, `*.db-journal`, `*.db-wal`, `*.db-shm` (if not already).

## RecentWrites
- [ ] `createRecentWrites()` returns a RecentWrites instance.
- [ ] `record(path)` stores the absolute path with current timestamp.
- [ ] `wasRecentlyWritten(path)` returns true if path was recorded within last 500ms.
- [ ] `wasRecentlyWritten(path)` returns false if path was recorded more than 500ms ago.
- [ ] `wasRecentlyWritten(path)` returns false for never-recorded paths.
- [ ] Old entries are pruned (either lazily on read or periodically).

## AtomicWriter
- [ ] `atomicWriteJson(path, data, recentWrites)` writes to temp file, fsyncs, renames atomically.
- [ ] JSON output has stable key ordering (alphabetical).
- [ ] JSON output has trailing newline.
- [ ] Temp file cleaned up on error.
- [ ] After successful write, calls `recentWrites.record(absolutePath)`.
- [ ] Test: successful write creates valid JSON file.
- [ ] Test: write to nonexistent parent directory throws (does not create parents).
- [ ] Test: concurrent writes to same file do not corrupt (last write wins, file always valid).
- [ ] Test: recentWrites is updated after successful write.

## Base record schema
- [ ] `BaseRecordSchema` defined with `id`, `createdAt`, `updatedAt`, `deletedAt`, `schemaVersion`.
- [ ] `id` validates as UUID v4.
- [ ] Timestamps validate as ISO 8601 with timezone offset.
- [ ] `deletedAt` is nullable.
- [ ] `schemaVersion` is positive integer.
- [ ] TypeScript type `BaseRecord` exported.

## CacheDb
- [ ] Constructor accepts `dbPath`.
- [ ] `init()` creates database file and tables if not exist.
- [ ] `upsert(table, record)` inserts new record or updates existing by `id`.
- [ ] `get(table, id)` returns record or null.
- [ ] `getAll(table)` returns all records in table.
- [ ] `remove(table, id)` deletes record from cache.
- [ ] `clear()` removes all data from all tables.
- [ ] `close()` closes database connection.
- [ ] Test: upsert then get returns same data.
- [ ] Test: remove then get returns null.
- [ ] Test: clear empties all tables.

## FileStore
- [ ] Constructor accepts folder path, Zod schema, and options (including `expectedSchemaVersion` and `recentWrites`).
- [ ] `get(id)` reads JSON file, validates, returns record or null if not found.
- [ ] `get(id)` throws on validation failure (after quarantine).
- [ ] `getAll()` returns all non-deleted records.
- [ ] `save(record)` validates, sets `updatedAt` to now, writes atomically, updates cache.
- [ ] `save(record)` throws if validation fails (data never written).
- [ ] `delete(id)` sets `deletedAt`, writes atomically, updates cache.
- [ ] `exists(id)` returns boolean without full parse.
- [ ] Validation failure moves file to `.quarantine/` with timestamp suffix.
- [ ] Validation failure logs the error.
- [ ] Custom `filenamePattern` option works.
- [ ] Test: save then get returns same record.
- [ ] Test: delete then getAll excludes deleted record.
- [ ] Test: invalid JSON triggers quarantine.
- [ ] Test: schema validation failure triggers quarantine.

## FileStore — Quarantine visibility
- [ ] When a file is quarantined, prints `⚠️  QUARANTINED: <path> — <reason>` to stderr.
- [ ] Quarantine warning prints regardless of `LOG_LEVEL` setting.
- [ ] Quarantine warning is also logged to log file.

## FileStore — Schema version handling
- [ ] If record's `schemaVersion` > `expectedSchemaVersion`, file is quarantined.
- [ ] Quarantine message for too-high version mentions "schema version too high" and both version numbers.
- [ ] If record's `schemaVersion` < `expectedSchemaVersion`, code has `// TODO(sprint-04)` comment for migration.
- [ ] If record's `schemaVersion` === `expectedSchemaVersion`, record is processed normally.
- [ ] Test: record with schemaVersion higher than expected is quarantined.
- [ ] Test: record with matching schemaVersion is loaded successfully.

## FileWatcher
- [ ] Watches `DATA_PATH` recursively.
- [ ] Debounces events (300ms default).
- [ ] Calls `onFileChange` for add/change/unlink events.
- [ ] Ignores `.quarantine/`, `*.tmp.*`, `inbox.txt`, `inbox-processed.txt`, `obsidian/`.
- [ ] `start()` begins watching.
- [ ] `stop()` stops watching and resolves when cleanup complete.
- [ ] Errors passed to `onError` callback.

## FileWatcher — Self-write suppression
- [ ] Constructor accepts `recentWrites` in options.
- [ ] On file event, checks `recentWrites.wasRecentlyWritten(path)`.
- [ ] If path was recently written by app (within 500ms), event is suppressed (no re-read, no cache update).
- [ ] If path was NOT recently written, event is processed as external change.
- [ ] Test: file written via AtomicWriter does not trigger FileWatcher callback within 500ms.
- [ ] Test: file written externally (not via AtomicWriter) triggers FileWatcher callback.

## Logger
- [ ] `createLogger(logDir, options)` returns logger instance.
- [ ] Writes JSON lines to `logDir/app-YYYY-MM-DD.log`.
- [ ] Each line has `ts`, `level`, `op`, `msg` fields.
- [ ] Additional `meta` fields merged into log entry.
- [ ] Creates `logDir` if missing.
- [ ] Rotates to new file on date change.
- [ ] `LOG_LEVEL` env var filters output (debug < info < warn < error).
- [ ] Default level is `info`.

## Logger — Log retention
- [ ] On initialization, scans for log files older than `LOG_RETENTION_DAYS`.
- [ ] Deletes log files older than retention period.
- [ ] On date rollover, scans and deletes old log files.
- [ ] `LOG_RETENTION_DAYS` env var is respected (default 30).
- [ ] Logs a debug entry when deleting old log files.
- [ ] Test: log files older than retention period are deleted on init.

## BackupService
- [ ] Constructor accepts `dataPath` and `backupPath`.
- [ ] `run()` copies data files to backup path (excludes `inbox.txt`, `.quarantine/`, `logs/`).
- [ ] `run()` stages and commits if changes exist.
- [ ] Commit message format: `backup: YYYY-MM-DD HH:mm`.
- [ ] Returns `{ committed: boolean, changedFiles: number }`.
- [ ] Returns `{ committed: false }` if no changes.
- [ ] Returns `{ error: string }` if backup repo doesn't exist or isn't a git repo.
- [ ] `startScheduler()` sets 24-hour interval.
- [ ] `stopScheduler()` clears interval.
- [ ] Backup runs on app startup.

## Integrity check
- [ ] `runIntegrityCheck(dataPath, cache)` returns `IntegrityReport`.
- [ ] Report includes `expectedSchemaVersion` and `foundSchemaVersion`.
- [ ] Checks `.schema-version` exists and matches expected value.
- [ ] Scans for iCloud conflict files (`* 2.json`, `* 3.json`, etc.) and reports paths.
- [ ] Lists files in `.quarantine/`.
- [ ] `orphanedReferences` is empty array (no entities yet to check).
- [ ] Rebuilds cache if any JSON file is newer than its cache entry.
- [ ] Reports `cacheRebuilt: true` if rebuild occurred.
- [ ] Logs summary of findings.

## Integrity check — Quarantine visibility
- [ ] If quarantined files are found, prints `⚠️  QUARANTINED FILE FOUND: <path>` to stderr for each.
- [ ] Quarantine warnings print regardless of `LOG_LEVEL` setting.

## Data directory initialization
- [ ] On startup, creates `DATA_PATH` folder structure if missing: `contacts/`, `interactions/`, `logs/`, `.quarantine/`.
- [ ] Creates `.schema-version` file containing `1` if missing.
- [ ] Creates `CACHE_DB_PATH` parent directory if missing.
- [ ] Does not overwrite existing files/folders.

## Startup sequence and failure handling
- [ ] Storage layer init failure (directories, cache DB) causes app to exit with non-zero code.
- [ ] Storage layer init failure prints clear error message to stderr.
- [ ] Missing or mismatched `.schema-version` causes app to exit with non-zero code.
- [ ] Missing `.schema-version` error message says "Data directory schema version mismatch or missing."
- [ ] Quarantined files found: logs warning, prints `⚠️` to stderr, app continues.
- [ ] iCloud conflict files found: logs warning, prints `⚠️` to stderr, app continues.
- [ ] Cache rebuild failure: logs error, app continues with empty cache.
- [ ] Backup failure: logs warning, app continues.
- [ ] File watcher init failure: logs warning, app continues with reduced functionality.
- [ ] On fatal error, DB connections are closed before exit.

## Server integration
- [ ] `server/index.ts` initializes storage layer on startup.
- [ ] Runs integrity check; logs report.
- [ ] Runs backup; logs result.
- [ ] Starts file watcher.
- [ ] On shutdown (SIGINT/SIGTERM), stops file watcher and closes cache DB cleanly.

## Test suite
- [ ] `npm run test` (or `npm test`) runs Vitest.
- [ ] All tests in `atomic-writer.test.ts` pass.
- [ ] All tests in `cache-db.test.ts` pass.
- [ ] All tests in `file-store.test.ts` pass.
- [ ] Tests use temp directories, cleaned up after run.
- [ ] No tests touch real `DATA_PATH` or `BACKUP_PATH`.

## Dev loop verification
- [ ] `npm run dev` starts server without errors.
- [ ] Logs appear in `DATA_PATH/logs/app-YYYY-MM-DD.log`.
- [ ] Integrity report logged on startup.
- [ ] Backup runs on startup (or logs that backup repo doesn't exist yet).
- [ ] Creating/modifying a JSON file in `DATA_PATH/contacts/` triggers file watcher (visible in logs).
- [ ] Modifying a file via the app does NOT trigger redundant file watcher processing (self-write suppression works).
- [ ] Ctrl+C shuts down cleanly (no orphan processes, DB closed).

## Code quality
- [ ] `npm run lint` passes.
- [ ] `npm run typecheck` passes.
- [ ] No `any` types without explanatory comment.
- [ ] All new files follow kebab-case naming.
- [ ] No empty catch blocks.
- [ ] `// TODO(sprint-04)` comment present for schema migration placeholder.

## Definition of done
All boxes above checked, the end-of-session documentation checklist from `CLAUDE.md` has been run, and the final commit has been pushed to GitHub.
