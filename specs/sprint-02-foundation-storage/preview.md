# Sprint 02 — Foundation Storage (preview)

*Not yet active. This is a preview so David knows what Sprint 01 is building toward. Do not implement this in Sprint 01.*

## Goal
Build the storage foundation that every real entity in the app will use. No user-facing entities yet — just the machinery: atomic file writes, Zod validation, SQLite cache, file watcher, structured logging, git backup service, startup integrity check. After this sprint, adding a new entity type (like Contact in Sprint 04) is a matter of defining its schema, not re-inventing persistence.

## Likely scope
- `AtomicWriter` utility implementing the write-temp-then-rename pattern with fsync.
- `FileStore<T>` generic class: given a Zod schema and a folder, provides CRUD over JSON files by UUID.
- Cache layer: SQLite cache via `better-sqlite3`, initialized from JSON on startup, kept in sync by file watcher.
- `chokidar` file watcher with debounced re-indexing on external edits.
- Structured JSON logger writing to `data/logs/app-YYYY-MM-DD.log`.
- Backup service: on startup and daily timer, syncs `DATA_PATH` to `BACKUP_PATH` git repo and commits.
- Startup integrity check: verifies `.schema-version`, scans for iCloud conflict files (`* 2.json`), scans for quarantined records, scans for orphaned references (no-op until entities exist), returns a summary.
- A test harness (Vitest). First tests cover AtomicWriter, FileStore, and the migration pipeline.

## Explicitly out
- Real entities (Contact, Interaction, etc.) — Sprint 04 onward.
- User-facing error display — Sprint 03.
- Data hygiene normalization for phone numbers — Sprint 04, when Contact lands.
