# ADR 010: Debug Error Format

**Status:** Accepted
**Date:** 2026-05-30

## Context

The application follows a "fail loud" philosophy: errors must surface immediately with enough context to diagnose and fix issues. Users need to be able to copy error details and paste them into a Claude Code session for debugging. This requires a standardized, machine-readable format that includes all relevant debugging information.

Additionally, the application needs a typed error hierarchy to distinguish between error types (validation failures, storage issues, network problems) and to encode retry semantics (which errors can be retried vs. which require user intervention).

## Decision

### Debug Block Format

All user-facing errors include a copyable debug block in the following format:

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

Fields:
- `ts`: ISO 8601 timestamp with milliseconds and Z suffix
- `error`: Error class name (e.g., "ValidationError", "StorageError")
- `message`: Human-readable error message
- `op`: Operation that failed (e.g., "contact.save", "fileStore.get")
- `context`: Additional key-value pairs for debugging
- `stack`: Full stack trace

The delimiters (`--- DEBUG BLOCK ---` and `--- END DEBUG BLOCK ---`) make it easy to identify and extract the JSON when pasted into a chat.

### Error Hierarchy

All application errors extend `AppError`:

```typescript
class AppError extends Error {
  readonly op: string;
  readonly context: Record<string, unknown>;
  readonly recoverable: boolean;
  readonly timestamp: string;

  toDebugBlock(): string;
  toJSON(): object;
}
```

Subclasses with their default `recoverable` values:
- `ValidationError` — `recoverable: false` — Invalid input data will remain invalid on retry
- `StorageError` — `recoverable: false` — File system or database failures require intervention
- `NetworkError` — `recoverable: true` — Transient connectivity issues may resolve
- `QuarantineError` — `recoverable: false` — Quarantined files must be manually repaired

### Recoverable Flag Semantics

The `recoverable` property encodes retry semantics:

- **`recoverable: true`**: The operation may be retried by the caller with appropriate backoff. Examples: network timeouts, iCloud sync lag, temporary API unavailability.

- **`recoverable: false`**: The operation must not be retried; surface to user immediately. Examples: validation failures, missing files, schema version mismatches.

Subclass `recoverable` values are locked and cannot be overridden by callers. The whole point of typed error classes is to encode the retry semantic in the type. If a caller needs a different semantic, they should use a different error class. TypeScript enforces this at compile time via literal types (`readonly recoverable: true` or `readonly recoverable: false`).

## Consequences

### What becomes easier
- Debugging: Users can copy-paste error blocks directly into Claude Code for assistance
- Consistency: All errors follow the same format across the application
- Retry logic: Code can check `error.recoverable` to decide whether to retry
- API responses: `toJSON()` provides a standard serialization for HTTP error responses

### What becomes harder
- All error throws must use typed errors (no bare `throw new Error()`)
- Error messages should be user-friendly since they appear in the UI

### New risks
- Debug blocks may contain sensitive data in `context` — ensure PII is not included
- Stack traces expose file paths, which is acceptable for a local-only single-user app

## Alternatives considered

**Plain text error format**: Rejected because JSON is easier to parse programmatically and includes structured context.

**Error codes instead of class names**: Rejected because class names are self-documenting and support `instanceof` checks.

**Always recoverable or never recoverable**: Rejected because different error types have genuinely different retry semantics. Network errors can resolve on retry; validation errors cannot.
