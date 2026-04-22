# ADR 007: Fail-loud error handling with atomic writes

**Status:** Accepted
**Date:** 2026-04-22

## Context
Silent failures are the worst class of bug for a personal data tool. A swallowed exception can cause unrecoverable data loss that isn't noticed for weeks. Optimistic UI updates that display "saved!" before the bytes are actually on disk are a common source of such failures. Non-atomic writes that leave partial files on disk compound the risk.

## Decision
Three rules govern error handling and persistence:

1. **Atomic writes only.** Every write of a JSON file goes through a single utility (`atomicWriteJson(path, data)`) that:
   - Serializes the JSON to a string with stable key ordering and a trailing newline.
   - Writes to a sibling temp file (`<path>.tmp.<randomId>`).
   - Calls `fsync` to force the bytes to disk.
   - Uses `rename` to atomically replace the target file.
   - On any error in this sequence, cleans up the temp file and throws.
   Direct `fs.writeFile` calls to the data directory are forbidden.

2. **Fail loud.** Every `catch` block must do exactly one of:
   - Recover meaningfully (with a log entry describing what was recovered from).
   - Surface the error to the user via the error-reporting system.
   - Rethrow to a higher layer that will surface it.
   Empty catches, `.catch(() => {})`, and "swallow and ignore" patterns are banned. Linting rules will flag them.

3. **No optimistic UI for persistence.** Save actions display a spinner until the underlying write resolves. "Saved" confirmation only appears after the atomic write completes successfully. If the write fails, the form stays open with unsaved data and the error is surfaced.

## Consequences
**Easier:** reliability. Partial-write corruption is eliminated. Data-loss surprises are eliminated. The app is auditable — if something is displayed, it is on disk.

**Harder:** slightly snappier UX is traded for trustworthiness. The spinner is visible for 50-200ms on most writes, which is imperceptible in practice.

**New risks:** a busy filesystem could slow writes; acceptable trade for guarantees.

## Alternatives considered
- **Optimistic UI with background save:** faster-feeling, but can display stale or wrong state when writes fail.
- **Writes directly to target path:** simpler code, but a crash mid-write corrupts the file.
- **Best-effort error handling:** some errors swallowed, some surfaced. Leads to inconsistency and hidden failures.
