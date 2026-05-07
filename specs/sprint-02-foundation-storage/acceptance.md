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
- [ ] `.env.example` updated with `DATA_PATH`, `CACHE_DB_PATH`, `BACKUP_PATH`, `LOG_LEVEL`.
- [ ] `.gitignore` updated to exclude `data/`, `*.db`, `*.db-journal`, `*.db-wal`, `*.db-shm` (if not already).

## AtomicWriter
- [ ] `atomicWriteJson(path, data)` writes to temp file, fsyncs, renames atomically.
- [ ] JSON output has stable key ordering (alphabetical).
- [ ] JSON output has trailing newline.
- [ ] Temp file cleaned up on error.
- [ ] Test: successful write creates valid JSON file.
- [ ] Test: write to nonexistent parent directory throws (does not create parents).
- [ ] Test: concurrent writes to same file do not corrupt (last write wins, file always valid).

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
- [ ] Constructor accepts folder path, Zod schema, and optional options.
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

## FileWatcher
- [ ] Watches `DATA_PATH` recursively.
- [ ] Debounces events (300ms default).
- [ ] Calls `onFileChange` for add/change/unlink events.
- [ ] Ignores `.quarantine/`, `*.tmp.*`, `inbox.txt`, `inbox-processed.txt`, `obsidian/`.
- [ ] `start()` begins watching.
- [ ] `stop()` stops watching and resolves when cleanup complete.
- [ ] Errors passed to `onError` callback.

## Logger
- [ ] `createLogger(logDir)` returns logger instance.
- [ ] Writes JSON lines to `logDir/app-YYYY-MM-DD.log`.
- [ ] Each line has `ts`, `level`, `op`, `msg` fields.
- [ ] Additional `meta` fields merged into log entry.
- [ ] Creates `logDir` if missing.
- [ ] Rotates to new file on date change.
- [ ] `LOG_LEVEL` env var filters output (debug < info < warn < error).
- [ ] Default level is `info`.

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
- [ ] Checks `.schema-version` exists and matches expected value.
- [ ] Scans for iCloud conflict files (`* 2.json`, `* 3.json`, etc.) and reports paths.
- [ ] Lists files in `.quarantine/`.
- [ ] `orphanedReferences` is empty array (no entities yet to check).
- [ ] Rebuilds cache if any JSON file is newer than its cache entry.
- [ ] Reports `cacheRebuilt: true` if rebuild occurred.
- [ ] Logs summary of findings.

## Data directory initialization
- [ ] On startup, creates `DATA_PATH` folder structure if missing: `contacts/`, `interactions/`, `logs/`, `.quarantine/`.
- [ ] Creates `.schema-version` file containing `1` if missing.
- [ ] Creates `CACHE_DB_PATH` parent directory if missing.
- [ ] Does not overwrite existing files/folders.

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
- [ ] Ctrl+C shuts down cleanly (no orphan processes, DB closed).

## Code quality
- [ ] `npm run lint` passes.
- [ ] `npm run typecheck` passes.
- [ ] No `any` types without explanatory comment.
- [ ] All new files follow kebab-case naming.
- [ ] No empty catch blocks.

## Definition of done
All boxes above checked, the end-of-session documentation checklist from `CLAUDE.md` has been run, and the final commit has been pushed to GitHub.
