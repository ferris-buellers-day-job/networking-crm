# Sprint 02 — Foundation Storage

## Goal
Build the storage foundation that every real entity in the app will use. No user-facing entities yet — just the machinery: atomic file writes, Zod validation, SQLite cache, file watcher, structured logging, git backup service, and startup integrity check. After this sprint, adding a new entity type (like Contact in Sprint 04) is a matter of defining its schema, not re-inventing persistence.

## Scope (what's in)

### 1. AtomicWriter utility
A single function implementing the write-temp-then-rename pattern per ADR 007:
- `atomicWriteJson(path: string, data: unknown): Promise<void>`
- Serializes JSON with stable key ordering (keys sorted alphabetically) and trailing newline.
- Writes to a sibling temp file (`<path>.tmp.<randomId>`).
- Calls `fsync` to force bytes to disk.
- Uses `rename` to atomically replace the target file.
- On any error, cleans up the temp file and throws.

### 2. FileStore<T> generic class
Given a Zod schema and a folder path, provides async CRUD over JSON files by UUID:
- `get(id: string): Promise<T | null>` — reads and validates; returns null if not found; throws on validation failure.
- `getAll(): Promise<T[]>` — returns all non-deleted records.
- `save(record: T): Promise<void>` — validates, sets `updatedAt`, writes atomically, updates cache eagerly.
- `delete(id: string): Promise<void>` — soft delete: sets `deletedAt`, writes atomically.
- `exists(id: string): Promise<boolean>` — checks existence without full parse.

Constructor: `new FileStore<T>(folder: string, schema: ZodType<T>, options?: FileStoreOptions)`

Options include:
- `filenamePattern?: (record: T) => string` — generates filename from record (default: `<id>.json`).
- `onValidationError?: (path: string, error: ZodError) => void` — hook for quarantine logic.

Internal behavior:
- Every read validates against the Zod schema. Validation failure triggers quarantine (move to `.quarantine/`) and throws.
- Every write validates before persisting. Invalid data never hits disk.
- After successful write, updates SQLite cache immediately (eager sync).

### 3. Base record schema
A Zod schema and TypeScript type for the common fields every record must have (per ADR 006):
```typescript
const BaseRecordSchema = z.object({
  id: z.string().uuid(),
  createdAt: z.string().datetime({ offset: true }),
  updatedAt: z.string().datetime({ offset: true }),
  deletedAt: z.string().datetime({ offset: true }).nullable(),
  schemaVersion: z.number().int().positive(),
});
```
Entity schemas will extend this base.

### 4. SQLite cache layer
A `CacheDb` class wrapping `better-sqlite3`:
- `init(): void` — creates tables if not exist; runs synchronously at startup.
- `upsert(table: string, record: BaseRecord & Record<string, unknown>): void` — inserts or updates.
- `remove(table: string, id: string): void` — deletes from cache (used when JSON file is deleted or quarantined).
- `getAll(table: string): unknown[]` — returns all rows.
- `get(table: string, id: string): unknown | null` — returns single row.
- `clear(): void` — drops all data (for full rebuild).
- `getLastModified(table: string, id: string): string | null` — returns `updatedAt` for staleness check.

Location: `CACHE_DB_PATH` from env (default: `./data/cache.db`, outside iCloud).

Schema per entity table:
- `id TEXT PRIMARY KEY`
- `data TEXT` (JSON blob of full record)
- `updated_at TEXT` (for quick staleness checks)

The cache is always disposable and rebuildable from JSON.

### 5. File watcher (chokidar)
Watches `DATA_PATH` for external changes:
- Debounced (300ms default) to batch rapid changes.
- On file add/change: re-read JSON, validate, update cache. On validation failure, quarantine.
- On file delete: remove from cache.
- Ignores: `.quarantine/`, `*.tmp.*`, `inbox.txt`, `inbox-processed.txt`, `obsidian/`.
- Provides a `stop()` method for clean shutdown.

Constructor: `new FileWatcher(dataPath: string, options: { debounceMs?: number, onError: (err: Error) => void })`

### 6. Structured JSON logger
Writes JSON lines to `DATA_PATH/logs/app-YYYY-MM-DD.log`:
```json
{"ts":"2026-04-23T14:32:00.000Z","level":"info","op":"fileStore.save","msg":"Saved contact","id":"a8f3c2..."}
```

API:
- `logger.info(op: string, msg: string, meta?: object): void`
- `logger.warn(op: string, msg: string, meta?: object): void`
- `logger.error(op: string, msg: string, meta?: object): void`
- `logger.debug(op: string, msg: string, meta?: object): void`

Behavior:
- Rotates by date (new file each day).
- Creates `logs/` directory if missing.
- Appends synchronously to avoid losing entries on crash.
- `LOG_LEVEL` env var controls minimum level (default: `info`).

### 7. Backup service
Per ADR 008, maintains a git repo at `BACKUP_PATH`:
- `runBackup(): Promise<BackupResult>` — copies `DATA_PATH` (excluding `inbox.txt`, `.quarantine/`, `logs/`) to `BACKUP_PATH`, stages, commits if changes exist.
- Commit message format: `backup: YYYY-MM-DD HH:mm`
- Returns `{ committed: boolean, changedFiles: number, error?: string }`.

Scheduling:
- Runs once on app startup.
- Runs daily via `setInterval` (24h) if app stays running.
- Skips commit if no changes detected.

Does NOT push to remote (local-only per ADR 008).

### 8. Startup integrity check
Runs at app boot, returns a structured report:
```typescript
interface IntegrityReport {
  schemaVersionOk: boolean;
  conflictFiles: string[];        // iCloud conflict pattern: "* 2.json"
  quarantinedFiles: string[];     // files in .quarantine/
  orphanedReferences: string[];   // placeholder — no entities yet
  cacheRebuilt: boolean;          // true if cache was stale/missing
  errors: string[];               // any errors encountered
}
```

Steps:
1. Check `.schema-version` file exists and matches expected version.
2. Scan for iCloud conflict files (`* 2.json`, `* 3.json`, etc.).
3. List files in `.quarantine/`.
4. Rebuild cache if missing or if any JSON file is newer than cache entry.
5. Log summary; return report.

The UI (Sprint 03) will surface this report in a System Status view.

### 9. Test harness (Vitest)
- Install Vitest as dev dependency.
- Configure in `vite.config.ts` or `vitest.config.ts`.
- First test files:
  - `server/lib/atomic-writer.test.ts` — tests write-rename-fsync behavior, cleanup on error.
  - `server/lib/file-store.test.ts` — tests CRUD, validation failure quarantine, schema versioning.
  - `server/lib/cache-db.test.ts` — tests upsert, get, clear.
- Tests use a temp directory, cleaned up after each run.

### 10. Data directory initialization
On first run, create the folder structure at `DATA_PATH`:
```
DATA_PATH/
├── contacts/           (empty, ready for Sprint 04)
├── interactions/       (empty, ready for Sprint 05)
├── logs/
├── .quarantine/
└── .schema-version     (contains "1")
```

Also ensure `CACHE_DB_PATH` parent directory exists.

## Scope (explicitly out)
- Real entities (Contact, Interaction, Tag, ActionItem) — Sprint 04+.
- User-facing error display / System Status UI — Sprint 03.
- Phone number normalization — Sprint 04 when Contact lands.
- Inbox processing — Sprint 05.
- Obsidian markdown projection — Sprint 09.
- Any frontend changes beyond health check — Sprint 03+.

## Directory layout (target additions)
```
server/
├── lib/
│   ├── atomic-writer.ts
│   ├── atomic-writer.test.ts
│   ├── file-store.ts
│   ├── file-store.test.ts
│   ├── cache-db.ts
│   ├── cache-db.test.ts
│   ├── file-watcher.ts
│   ├── logger.ts
│   ├── backup-service.ts
│   ├── integrity-check.ts
│   └── schemas/
│       └── base-record.ts
├── services/
│   └── storage.ts          (wires together FileStore, CacheDb, FileWatcher)
└── index.ts                (updated: init storage on startup)
```

## Interfaces (load-bearing abstractions)

### AtomicWriter
```typescript
export function atomicWriteJson(path: string, data: unknown): Promise<void>;
```

### FileStore
```typescript
export interface FileStoreOptions<T> {
  filenamePattern?: (record: T) => string;
  onValidationError?: (path: string, error: ZodError) => void;
}

export class FileStore<T extends BaseRecord> {
  constructor(folder: string, schema: ZodType<T>, options?: FileStoreOptions<T>);
  get(id: string): Promise<T | null>;
  getAll(): Promise<T[]>;
  save(record: T): Promise<void>;
  delete(id: string): Promise<void>;
  exists(id: string): Promise<boolean>;
}
```

### CacheDb
```typescript
export class CacheDb {
  constructor(dbPath: string);
  init(): void;
  upsert(table: string, record: BaseRecord & Record<string, unknown>): void;
  remove(table: string, id: string): void;
  get(table: string, id: string): unknown | null;
  getAll(table: string): unknown[];
  clear(): void;
  close(): void;
}
```

### FileWatcher
```typescript
export interface FileWatcherOptions {
  debounceMs?: number;
  onFileChange: (path: string, event: 'add' | 'change' | 'unlink') => Promise<void>;
  onError: (err: Error) => void;
}

export class FileWatcher {
  constructor(dataPath: string, options: FileWatcherOptions);
  start(): void;
  stop(): Promise<void>;
}
```

### Logger
```typescript
export interface Logger {
  info(op: string, msg: string, meta?: object): void;
  warn(op: string, msg: string, meta?: object): void;
  error(op: string, msg: string, meta?: object): void;
  debug(op: string, msg: string, meta?: object): void;
}

export function createLogger(logDir: string): Logger;
```

### BackupService
```typescript
export interface BackupResult {
  committed: boolean;
  changedFiles: number;
  error?: string;
}

export class BackupService {
  constructor(dataPath: string, backupPath: string);
  run(): Promise<BackupResult>;
  startScheduler(): void;
  stopScheduler(): void;
}
```

### IntegrityCheck
```typescript
export interface IntegrityReport {
  schemaVersionOk: boolean;
  conflictFiles: string[];
  quarantinedFiles: string[];
  orphanedReferences: string[];
  cacheRebuilt: boolean;
  errors: string[];
}

export function runIntegrityCheck(dataPath: string, cache: CacheDb): Promise<IntegrityReport>;
```

## Environment variables (new)
Add to `.env.example`:
```
DATA_PATH=~/Library/Mobile Documents/com~apple~CloudDocs/NetworkingCRM
CACHE_DB_PATH=./data/cache.db
BACKUP_PATH=~/NetworkingCRM-backup
LOG_LEVEL=info
```

## Dependencies to add
```json
{
  "dependencies": {
    "better-sqlite3": "^11.0.0",
    "chokidar": "^3.6.0",
    "zod": "^3.23.0"
  },
  "devDependencies": {
    "@types/better-sqlite3": "^7.6.0",
    "vitest": "^1.6.0"
  }
}
```

## Decisions made (incorporated from open questions)
1. **FileStore API:** Async (Promise-based) — keeps door open for future async operations.
2. **Cache sync:** Eager for internal writes (immediate cache update after JSON write); lazy via file watcher for external edits.
3. **Backup scheduling:** Both startup and daily timer.
4. **Log rotation:** By date (`app-YYYY-MM-DD.log`).
5. **Zod version:** 3.23+ (latest stable).
6. **Test harness:** Vitest.

## Acceptance criteria
See `acceptance.md`.

## Working notes
Append decisions made during the sprint to `notes.md`. At sprint close, promote durable decisions to ADRs if needed.

## Prompts to use with Claude Code this sprint
- *Session 1:* "Read `CLAUDE.md`, then `specs/sprint-02-foundation-storage/spec.md`. Implement AtomicWriter and its tests. Do not proceed to FileStore yet."
- *Session 2:* "Continue Sprint 02. Implement CacheDb and its tests."
- *Session 3:* "Continue Sprint 02. Implement FileStore and its tests."
- *Session 4:* "Continue Sprint 02. Implement FileWatcher, Logger, and data directory initialization."
- *Session 5:* "Continue Sprint 02. Implement BackupService and IntegrityCheck. Wire everything together in storage.ts and update server startup."
- *Closing session:* "Run all tests, verify startup works, run the end-of-session documentation checklist from `CLAUDE.md`."
