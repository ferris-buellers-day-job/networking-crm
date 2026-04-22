# ADR 010: Error reporting designed for Claude Code troubleshooting

**Status:** Accepted
**Date:** 2026-04-22

## Context
David maintains this project with Claude Code as the primary development partner. When something goes wrong, the natural troubleshooting flow is: see error in the app → open Claude Code → describe the problem. The quality of that diagnosis depends heavily on what information David can provide. Generic error messages ("Something went wrong") force David to piece together context from memory and logs. Structured, copyable debug reports let Claude Code diagnose immediately.

## Decision
Every user-facing error display includes three zones:

1. **User-friendly heading** — one sentence describing what failed in plain language.
2. **Suggested actions** — a short list of things the user can try (retry, check disk space, etc.).
3. **Debug block** — a collapsible, copy-to-clipboard markdown block designed to be pasted into a Claude Code session. It includes:
   - Error class, message, and code.
   - Operation name and relevant IDs (e.g., `writeContact(id=a8f3c2...)`).
   - File paths involved.
   - Timestamp (ISO 8601).
   - App version from `package.json` and git commit SHA.
   - Node.js version.
   - Tail of the log file from the last 50 entries.
   - Operational context (unsaved changes count, cache freshness, last successful write of same type).
   - Stack trace.

The debug block is rendered as a markdown code fence so pasting it into Claude Code preserves formatting. A single "Copy debug info" button puts the whole block on the clipboard.

Server-side errors bubble up to a single error handler that constructs this structure; React renders it in a dedicated `<ErrorDisplay />` component; an error boundary at the root catches render-time crashes and renders the same component.

Every error, whether shown to the user or not, is also written to the log file with the same structured fields so historical debugging is possible.

## Consequences
**Easier:** pasting a debug block into Claude Code produces high-signal diagnosis. David does not have to remember or reconstruct context. Bugs get fixed faster and more reliably.

**Harder:** slightly more plumbing — every operation that can error needs to pass its context through to the error handler. Mitigated by a `withErrorContext(operation, context, fn)` wrapper utility that standardizes this.

**New risks:** debug blocks could contain sensitive data (contact names, note content). Acceptable because David is the sole user and the only person pasting them into Claude Code.

## Alternatives considered
- **Generic error messages:** fails the troubleshooting use case.
- **Full structured logging to a remote service (Sentry, etc.):** sends sensitive data to a third party; violates the privacy rule.
- **Errors only in the log file, not in the UI:** requires David to hunt through logs after every issue. The whole point is to make diagnosis frictionless.
