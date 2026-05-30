# Sprint 03 — Error Handling

## Goal
Implement the "fail loud" error handling framework described in the vision and CLAUDE.md. Every error must either recover meaningfully, surface to the user, or rethrow. Silent failures are unacceptable. Users see actionable error messages with copyable debug blocks.

## Scope (what's in)

### 1. Debug block format (ADR 010)
Define the standard format for copyable debug blocks that accompany every user-facing error. The format should be:
- Self-contained enough to paste into a Claude Code session verbatim.
- Include timestamp, error type, message, stack trace, and relevant context (file path, record ID, operation name).
- Machine-readable (JSON) but human-scannable.

Format:
```
--- DEBUG BLOCK ---
{
  "ts": "2026-05-30T14:32:00.000Z",
  "error": "ValidationError",
  "message": "Invalid phone number format",
  "op": "contact.save",
  "context": {
    "contactId": "abc-123",
    "field": "phone",
    "value": "+1-555-000"
  },
  "stack": "ValidationError: Invalid phone number format\n    at validate (/server/lib/file-store.ts:45:11)\n    ..."
}
--- END DEBUG BLOCK ---
```

Create `docs/decisions/010-debug-error-format.md` documenting this format.

### 2. AppError base class and error hierarchy
Create a typed error hierarchy for all application errors:

```typescript
// server/lib/errors.ts

/**
 * Base class for all application errors.
 *
 * @property recoverable - If true, the operation may be retried by the caller
 *   with appropriate backoff (e.g., transient network issues, iCloud sync lag).
 *   If false, the operation must not be retried; surface to user immediately.
 */
export class AppError extends Error {
  readonly op: string;
  readonly context: Record<string, unknown>;
  readonly recoverable: boolean;
  readonly timestamp: string;

  constructor(message: string, options: {
    op: string;
    context?: Record<string, unknown>;
    recoverable?: boolean;
    cause?: Error;
  });

  toDebugBlock(): string;  // generates the copyable debug format
  toJSON(): object;        // for API serialization
}

export class ValidationError extends AppError { /* recoverable: false */ }
export class StorageError extends AppError { /* recoverable: false */ }
export class NetworkError extends AppError { /* recoverable: true */ }
export class QuarantineError extends AppError { /* recoverable: false */ }
```

Rules:
- `recoverable: true` — caller may retry with backoff.
- `recoverable: false` — caller must not retry; surface to user.
- Every `throw` in application code uses one of these typed errors.
- Stack traces are preserved via `cause` chaining.

### 3. API error response format
All API endpoints return errors in a consistent format:

```typescript
// 4xx or 5xx response body
interface ApiErrorResponse {
  error: {
    type: string;       // e.g., "ValidationError", "StorageError"
    message: string;    // user-friendly message
    debugBlock: string; // full debug block for copy/paste
  };
}
```

### 4. Express error middleware
A global error handler added as final middleware:
- Catches all unhandled errors from route handlers.
- If error is an `AppError` instance, converts to `ApiErrorResponse` format.
- If error is an unknown value (not an `AppError`), wraps it in a generic `AppError` with the original as `cause`.
- Logs all errors to server log via the existing logger.
- Sets HTTP status codes based on error type:
  - `ValidationError` → 400 Bad Request
  - `QuarantineError` → 422 Unprocessable Entity
  - `StorageError` → 500 Internal Server Error
  - Unknown errors (wrapped in `AppError`) → 500
  - `NetworkError` → 500 (should not appear server-side; treat as unexpected)
- Never leaks raw stack traces outside the debug block wrapper.

### 5. Client error logging endpoint
`POST /api/log-client-error` accepts client-side errors for server-side correlation:

```typescript
interface ClientErrorLog {
  debugBlock: string;
  url: string;
  userAgent: string;
}
```

Behavior:
- Logs to the standard log file with `op: 'client.error'`.
- Returns 204 No Content on success.
- Returns 400 if `debugBlock` is missing.

### 6. API client wrapper
A thin wrapper around `fetch` used by all React components:

```typescript
// client/lib/api.ts
export async function apiFetch<T>(path: string, options?: RequestInit): Promise<T>;
```

Behavior:
- Parses JSON response.
- On non-2xx response, throws `ApiError` with the debug block from the server.
- On network failure (fetch rejects), throws `NetworkError`.
- Never silently swallows errors.

### 7. React error boundary
A top-level error boundary catches unhandled React errors:
- Renders an error state with:
  - Friendly message ("Something went wrong")
  - Expandable/copyable debug block (collapsed by default)
  - "Try again" button
- "Try again" re-renders the boundary's children by resetting internal state (e.g., incrementing a key), not a full page reload.
- Logs the error to the server via `POST /api/log-client-error`.

### 8. Health endpoint enhancement
Extend `GET /api/health` to include a status field:

```typescript
interface HealthResponse {
  status: 'ok' | 'degraded' | 'error';
  version: string;
  commit: string;
  integrity: {
    ok: boolean;
    warnings: number;
    lastChecked: string;
  };
}
```

Status logic:
- `ok`: integrity check passed with zero warnings.
- `degraded`: integrity check passed but has warnings (quarantined files, iCloud conflicts, backup failed, watcher stopped).
- `error`: integrity check failed (should not happen if app is running).

This is data-only; no UI changes to display status in this sprint.

## Scope (explicitly out)
- Toast notification system — Sprint 03.5.
- System Status view (`/status` route) — Sprint 03.5.
- Header status indicator — Sprint 03.5.
- Quarantine repair flow (view, delete, re-import) — Sprint 03.5.
- Log viewer UI — Sprint 03.5.
- Real entities (Contact, Interaction) — Sprint 04+.

## Directory layout (target additions)
```
server/
├── lib/
│   ├── errors.ts              (AppError hierarchy)
│   └── errors.test.ts
├── middleware/
│   └── error-handler.ts       (Express error middleware)
├── routes/
│   ├── health.ts              (enhanced)
│   └── client-error.ts        (new - client error logging)
└── index.ts                   (wire middleware and routes)

client/
├── lib/
│   ├── api.ts                 (fetch wrapper)
│   └── api-error.ts           (ApiError class for client)
├── components/
│   └── error-boundary.tsx
└── App.tsx                    (wrap with ErrorBoundary)

docs/decisions/
└── 010-debug-error-format.md
```

## Interfaces

### AppError
```typescript
/**
 * Base class for all application errors.
 *
 * @property recoverable - If true, the operation may be retried by the caller
 *   with appropriate backoff. If false, the operation must not be retried;
 *   surface to user immediately.
 */
export class AppError extends Error {
  readonly op: string;
  readonly context: Record<string, unknown>;
  readonly recoverable: boolean;
  readonly timestamp: string;

  constructor(message: string, options: {
    op: string;
    context?: Record<string, unknown>;
    recoverable?: boolean;
    cause?: Error;
  });

  toDebugBlock(): string;
  toJSON(): object;
}
```

### API error response
```typescript
interface ApiErrorResponse {
  error: {
    type: string;
    message: string;
    debugBlock: string;
  };
}
```

### Client error log
```typescript
// POST /api/log-client-error
interface ClientErrorLog {
  debugBlock: string;
  url: string;
  userAgent: string;
}
```

### Health response
```typescript
interface HealthResponse {
  status: 'ok' | 'degraded' | 'error';
  version: string;
  commit: string;
  integrity: {
    ok: boolean;
    warnings: number;
    lastChecked: string;
  };
}
```

## Environment variables (no changes)
No new environment variables for this sprint.

## Dependencies to add
None. This sprint uses only existing dependencies.

## Acceptance criteria
See `acceptance.md`.

## Prompts to use with Claude Code this sprint
- *Session 1:* "Read `CLAUDE.md`, then `specs/sprint-03-error-handling/spec.md`. Implement AppError hierarchy with tests and create ADR 010 for the debug block format."
- *Session 2:* "Continue Sprint 03. Implement Express error middleware, client error endpoint, apiFetch wrapper, ErrorBoundary, and health endpoint update. Add tests for each. Run the end-of-session documentation checklist."
