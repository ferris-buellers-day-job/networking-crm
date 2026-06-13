# Changelog

All notable changes to this project are documented here.

## [0.4.0] - 2026-06-13

### Added

- **Sprint 04 — Contacts**
  - **Contact schema** (`server/schemas/contact.ts`)
    - Zod schema with all fields: name, preferredName, linkedinUrl, phone, defaultCountry, email, company, title, notes, plus standard base fields (id, createdAt, updatedAt, deletedAt, schemaVersion)
    - `CONTACT_SCHEMA_VERSION = 1` per ADR 012
  - **Phone utilities** (`server/lib/phone.ts`, `client/lib/phone.ts`)
    - `normalizePhone()` — E.164 normalization via libphonenumber-js, honors `DEFAULT_COUNTRY` env var, falls back to US
    - `formatPhoneForDisplay()` — national format for matching country, international otherwise
  - **Contacts API** (`server/routes/contacts.ts`)
    - `GET /api/contacts` — list active contacts sorted by name case-insensitively
    - `GET /api/contacts/:id` — single contact; 404 for missing, soft-deleted, or quarantined
    - `POST /api/contacts` — create with phone normalization, email domain lowercasing, strict field validation
    - `PUT /api/contacts/:id` — partial update; same normalizations; 404 for missing/deleted/quarantined
    - `DELETE /api/contacts/:id` — soft delete (sets deletedAt); 404 for already-deleted/missing/quarantined
  - **Contact list page** (`client/pages/contact-list.tsx`)
    - Fetches and displays active contacts with name, company, email columns
    - Displays preferredName in place of name when set
    - Client-side search across name, company, email (not notes)
    - Row links to `/contacts/:id`; "New Contact" link to `/contacts/new`
    - Empty state, loading state, no-results state
  - **Contact detail page** (`client/pages/contact-detail.tsx`)
    - Displays all populated fields; phone formatted via `formatPhoneForDisplay()`
    - LinkedIn URL rendered as `<a target="_blank">`
    - Edit link → `/contacts/:id/edit`; Delete button with ConfirmModal
    - 404 handled inline; other errors propagated to ErrorBoundary
  - **Contact form page** (`client/pages/contact-form.tsx`)
    - Create mode (`/contacts/new`) and edit mode (`/contacts/:id/edit`) via same component
    - Phone validated at blur time against defaultCountry captured at that moment
    - LinkedIn URL validated on submit
    - Server ApiErrors shown inline; other errors propagated to ErrorBoundary
  - **ConfirmModal component** (`client/components/confirm-modal.tsx`)
    - Accessible dialog with focus trap (Cancel initial focus, Tab cycles, ESC cancels)
    - Restores focus to opener on close
  - **CountrySelect component** (`client/components/country-select.tsx`)
    - Full country list from libphonenumber-js, sorted by Intl.DisplayNames
    - Empty option maps to null
  - **Client routing** — added `/contacts/new` and `/contacts/:id/edit` routes
  - **ADR 012** — per-entity schema versioning

### Dependencies

- Added `react-router-dom` v7 for client-side routing

### Test suite

- 337 tests total (222 → 337, +115 new tests)

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
