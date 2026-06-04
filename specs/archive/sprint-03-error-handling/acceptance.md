# Sprint 03 — Acceptance Criteria

Check each box when met. Claude Code should update this file as items complete.

## AppError hierarchy

### AppError base class
- [ ] `AppError` extends `Error` with `op`, `context`, `recoverable`, `timestamp` properties.
- [ ] Constructor accepts `message` and options object with `op`, `context`, `recoverable`, `cause`.
- [ ] `toDebugBlock()` returns formatted debug string with delimiters.
- [ ] `toJSON()` returns serializable object for API responses.
- [ ] Stack trace is preserved (including from `cause` if provided).
- [ ] `timestamp` is set to current ISO 8601 timestamp on construction.
- [ ] Class docstring defines `recoverable` operationally: "If true, caller may retry with backoff. If false, caller must not retry; surface to user."

### Error subclasses
- [ ] `ValidationError` extends `AppError` with `recoverable: false`.
- [ ] `StorageError` extends `AppError` with `recoverable: false`.
- [ ] `NetworkError` extends `AppError` with `recoverable: true`.
- [ ] `QuarantineError` extends `AppError` with `recoverable: false`.

### Debug block format
- [ ] Debug block starts with `--- DEBUG BLOCK ---`.
- [ ] Debug block ends with `--- END DEBUG BLOCK ---`.
- [ ] Debug block contains valid JSON between delimiters.
- [ ] JSON includes `ts`, `error`, `message`, `op`, `context`, `stack`.
- [ ] Test: extract JSON from between delimiters, verify it parses.
- [ ] Test: verify parsed object has fields `ts`, `error`, `message`, `op`, `context`, `stack`.
- [ ] Test: verify `ts` matches ISO 8601 format.
- [ ] Test: verify `error` equals the error class name (e.g., "ValidationError").

### Tests
- [ ] Test: AppError constructor sets all properties correctly.
- [ ] Test: AppError with `cause` preserves original stack.
- [ ] Test: Each subclass sets correct default `recoverable` value.
- [ ] Test: `toJSON()` returns expected structure.

## ADR 010

- [ ] `docs/decisions/010-debug-error-format.md` created.
- [ ] Documents the debug block format (delimiters, JSON structure).
- [ ] Documents the error hierarchy (AppError and subclasses).
- [ ] Documents the `recoverable` flag semantics.
- [ ] Follows ADR template format.

## Express error middleware

- [ ] Global error handler registered as final middleware.
- [ ] Catches `AppError` instances and converts to `ApiErrorResponse` format.
- [ ] Catches unknown errors and wraps in generic `AppError` with original as `cause`.
- [ ] Logs all errors to server log via existing logger.
- [ ] Sets HTTP 400 for `ValidationError`.
- [ ] Sets HTTP 422 for `QuarantineError`.
- [ ] Sets HTTP 500 for `StorageError`.
- [ ] Sets HTTP 500 for unknown errors (wrapped in `AppError`).
- [ ] Sets HTTP 500 for `NetworkError` if thrown server-side (unexpected).
- [ ] Response body matches `ApiErrorResponse` interface.
- [ ] Never leaks raw stack traces outside debug block.
- [ ] Test: `AppError` thrown in route returns proper response format.
- [ ] Test: Unknown error thrown in route returns wrapped `AppError` response.

## Client error logging endpoint

- [ ] `POST /api/log-client-error` accepts `{ debugBlock, url, userAgent }`.
- [ ] Logs to server log with `op: 'client.error'`.
- [ ] Returns 204 No Content on success.
- [ ] Returns 400 if `debugBlock` is missing.
- [ ] Test: Valid request logs and returns 204.
- [ ] Test: Missing `debugBlock` returns 400.

## API client wrapper

- [ ] `apiFetch<T>(path, options)` function exported from `client/lib/api.ts`.
- [ ] Parses JSON response automatically.
- [ ] Throws `ApiError` on non-2xx response with debug block from server.
- [ ] Throws `NetworkError` on network failure (fetch rejects).
- [ ] `ApiError` class defined in `client/lib/api-error.ts`.
- [ ] Test: Mock server error returns `ApiError` with debug block.
- [ ] Test: Network failure throws `NetworkError`.

## React error boundary

- [ ] `ErrorBoundary` component wraps application in `App.tsx`.
- [ ] Catches errors during render, lifecycle, and constructors.
- [ ] Renders error UI with friendly message ("Something went wrong").
- [ ] Shows expandable debug block (collapsed by default).
- [ ] Debug block is selectable and copyable.
- [ ] "Try again" button re-renders children (via key reset), not full page reload.
- [ ] Logs error to server via `POST /api/log-client-error`.
- [ ] After 3 consecutive errors in the same mount, disables "Try again" button and only offers "Reload" (prevents infinite reset loops).
- [ ] Test: Throwing in a child component shows error UI.
- [ ] Test: "Try again" resets error state and re-renders children.
- [ ] Test: After 3 consecutive errors, "Try again" is disabled and "Reload" is shown.

## Health endpoint

- [ ] `GET /api/health` returns `status` field ('ok', 'degraded', 'error').
- [ ] Status is 'ok' if integrity check passed with zero warnings.
- [ ] Status is 'degraded' if integrity check passed but has warnings.
- [ ] Status is 'error' if integrity check failed (edge case).
- [ ] Response still includes `version`, `commit`, `integrity` fields.
- [ ] Test: Health returns 'ok' when no warnings.
- [ ] Test: Health returns 'degraded' when warnings exist.

## Integration

- [ ] Error middleware wired in `server/index.ts`.
- [ ] Client error route mounted in `server/index.ts`.
- [ ] `App.tsx` wrapped in `ErrorBoundary`.
- [ ] Existing health route uses `apiFetch` (if applicable).

## Test suite

- [ ] `npm run test` runs all tests.
- [ ] `server/lib/errors.test.ts` passes.
- [ ] Error middleware tests pass.
- [ ] Client error endpoint tests pass.
- [ ] No tests touch real `DATA_PATH`.

## Dev loop verification

- [ ] `npm run dev` starts server without errors.
- [ ] Triggering a server error returns proper error response with debug block.
- [ ] Error boundary catches React errors and shows UI.
- [ ] "Try again" re-renders without full page reload.
- [ ] Client errors are logged to server log file.
- [ ] Health endpoint returns correct status.
- [ ] Ctrl+C shuts down cleanly.

## Code quality

- [ ] `npm run lint` passes.
- [ ] `npm run typecheck` passes.
- [ ] No `any` types without explanatory comment.
- [ ] All new files follow kebab-case naming.
- [ ] No empty catch blocks.

## Documentation

- [ ] ADR 010 created and complete.
- [ ] `CLAUDE.md` updated if needed.
- [ ] `CHANGELOG.md` entry added at sprint close.

## Definition of done
All boxes above checked, the end-of-session documentation checklist from `CLAUDE.md` has been run, and the final commit has been pushed to GitHub.
