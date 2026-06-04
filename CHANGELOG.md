# Changelog

All notable changes to this project are documented here.

## [0.3.0] - 2026-06-03

### Added

- **Sprint 03 — Error Handling**
  - **Error hierarchy** (ADR 010)
    - `AppError` base class with `op`, `context`, `recoverable`, `toDebugBlock()`
    - Typed subclasses: `ValidationError`, `StorageError`, `NetworkError`, `QuarantineError`
    - Locked `recoverable` defaults per subclass (compile-time enforced)
  - **Server-side error handling**
    - Express error middleware with safety fallbacks (headersSent check, try/catch wrapper, plain-text fallback)
    - HTTP status mapping: ValidationError→400, QuarantineError→422, others→500
    - `POST /api/log-client-error` endpoint for client error reporting
    - Health endpoint enhanced with `status` field ('ok' | 'degraded' | 'error')
  - **Client-side error handling**
    - `ApiError` and `NetworkError` classes with debug block support
    - `apiFetch<T>()` wrapper — throws typed errors on non-2xx or network failure
    - React `ErrorBoundary` with collapsible debug block, "Try again" (key reset), 3-strike disable logic
    - Fire-and-forget error logging to server via raw fetch
  - **Test suite**
    - 48 new tests (174 → 222 total)
    - Client tests use per-file `// @vitest-environment jsdom`; server tests stay on Node

### Dependencies

- Added `supertest`, `@testing-library/react`, `@testing-library/jest-dom`, `jsdom` for testing

## [0.2.0] - 2026-05-23

### Added

- **Sprint 02 — Foundation Storage**
  - **Core utilities**
    - `RecentWrites` — shared map for self-write suppression (500ms window)
    - `AtomicWriter` — write-temp-fsync-rename pattern per ADR 007
    - `BaseRecordSchema` — Zod schema with id, createdAt, updatedAt, deletedAt, schemaVersion
  - **Storage layer**
    - `CacheDb` — SQLite cache via better-sqlite3, disposable and rebuildable
    - `FileStore<T>` — generic async CRUD over JSON files with Zod validation and quarantine
    - `FileWatcher` — chokidar-based watcher with debouncing, self-write suppression, and state machine lifecycle
    - `BackupService` — git-based daily backup of DATA_PATH with mirror semantics
    - `IntegrityCheck` — startup validation of .schema-version, iCloud conflicts, quarantine, cache staleness
  - **Structured logging**
    - `Logger` — JSON line format, date rotation, configurable retention
  - **Integration layer**
    - `server/services/storage.ts` — wires all components with shared instances
    - `FatalStorageError` — typed error for separating library failure from process control
    - Graceful shutdown with 10-second timeout on SIGINT/SIGTERM
    - Health endpoint now reports integrity status with warnings count and lastChecked timestamp
  - **Test suite**
    - 138 tests covering all foundation components
    - Vitest configuration with temp directory isolation

### Changed

- `.env.example` updated with LOG_LEVEL and LOG_RETENTION_DAYS variables

## [0.1.0] - 2026-04-23

### Added

- **Sprint 01 — Skeleton**
  - Project scaffolding: Git repo, TypeScript config, Vite + React setup
  - Express server bound to `127.0.0.1:3000` with Vite dev middleware
  - Health endpoint (`GET /api/health`) returning version and git commit
  - React client fetching health status and displaying "Ready" or error state
  - Comprehensive documentation: vision, architecture, conventions, ADRs 001-011
  - README with full setup instructions for new and existing Macs
  - `.env.example` with all configuration variables documented
