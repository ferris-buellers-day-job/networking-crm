# Sprint 06 — Acceptance Criteria

## Session 1

### Inbox format and parser

- [ ] Parser correctly parses a complete valid entry with all fields, including a multi-line summary spanning multiple lines.
- [ ] Parser returns a `ParsedEntry` with `parseError` set when `id` is missing.
- [ ] Parser returns a `ParsedEntry` with `parseError` set when `id` is present but does not match `[0-9a-fA-F]{8}`.
- [ ] Parser returns a `ParsedEntry` with `parseError` set when `date` is missing.
- [ ] Parser returns a `ParsedEntry` with `parseError` set when `date` is present but does not match the strict ISO 8601 pattern (date + time + offset or Z required).
- [ ] A loosely-formatted but non-ISO date value (e.g. `"June 28 2026"`) is treated as a `parse_error` — not coerced to a timestamp.
- [ ] Parser returns a `ParsedEntry` with `parseError` set when `contact` is missing or empty after trimming.
- [ ] Parser returns a `ParsedEntry` with `parseError` set for an unclosed block (opening `---` with no closing `---` before EOF or the next opening `---`).
- [ ] Parser defaults `parsedType` to `'meeting'` when the `type` field is absent — no parse error.
- [ ] Parser defaults `parsedType` to `'meeting'` when the `type` field contains an unrecognized value — no parse error.
- [ ] Parser sets `parsedLocation = null` for an entry with no `location` field — no parse error.
- [ ] Parser sets `parsedSummary = null` for an entry with no `summary` field — no parse error.
- [ ] **Date UTC conversion:** parser converts an offset-bearing `date` value (`2026-06-28T15:30:00-07:00`) to `parsedDate = '2026-06-28T22:30:00.000Z'`. `parsedDate` always stores the UTC-Z form.
- [ ] A minute-precision ISO string with offset and no seconds (e.g. `2026-06-28T15:30-07:00`) parses successfully (not a parse error) and converts to the correct UTC-Z value (`2026-06-28T22:30:00.000Z`).
- [ ] `INBOX_ENTRY_SCHEMA_VERSION = 1` is exported from `server/schemas/inbox-entry.ts`.
- [ ] FileStore for inbox entries is constructed with `expectedSchemaVersion: INBOX_ENTRY_SCHEMA_VERSION`.

### POST /api/inbox/process

- [ ] Returns `{ processed: 0, queued: 0 }` when `inbox.txt` is empty or absent.
- [ ] Auto-matched entry (exactly one contact name match) creates both an Interaction and an InboxEntry with `status: 'resolved'`, `matchState: 'auto_matched'`, `interactionId` set.
- [ ] Ambiguous entry (2+ contact name matches) creates an InboxEntry with `status: 'pending'`, `matchState: 'ambiguous'`, and `candidateContactIds` populated with the matching contact UUIDs.
- [ ] Unmatched entry (0 contact name matches) creates an InboxEntry with `status: 'pending'`, `matchState: 'unmatched'`.
- [ ] Parse-error entry creates an InboxEntry with `status: 'pending'`, `matchState: 'parse_error'`, `parseError` message set.
- [ ] Re-running `POST /api/inbox/process` on the same `inbox.txt` creates no duplicate InboxEntry or Interaction records — rawId idempotency applies uniformly to all `matchState` values (`auto_matched`, `ambiguous`, `unmatched`, `parse_error`).
- [ ] On a re-run where entries are skipped via rawId, those skipped entries are NOT re-appended to `inbox-processed.txt` (no duplicate audit lines).
- [ ] **Byte-level truncation / concurrent-append safety:** a non-ASCII entry (e.g. contact name "José García" containing multibyte UTF-8 characters) appended to `inbox.txt` after the initial Buffer read — simulated in a test by writing additional bytes to the file between the read and the write-back — survives the process run intact in `inbox.txt` and is not corrupted or lost.
- [ ] Processed entries' `rawText` is appended to `inbox-processed.txt` after a run.
- [ ] After a successful run, `inbox.txt` contains only content appended after the initial read (empty if nothing new was appended).

### GET /api/inbox

- [ ] Returns `{ entries: [] }` when no pending InboxEntry records exist.
- [ ] Returns only entries with `status: 'pending'`, sorted by `createdAt` ascending (oldest first).
- [ ] Does not return entries with `status: 'resolved'` or `status: 'discarded'`.

### PATCH /api/inbox/:id/resolve

- [ ] Creates an Interaction from the entry's parsed fields and returns 200 with the updated InboxEntry.
- [ ] Sets `status: 'resolved'`, `contactId`, and `interactionId` on the InboxEntry.
- [ ] The created Interaction's `contactId` is the `contactId` supplied in the PATCH body (the user's explicit resolution choice) — NOT derived from `parsedContact`, which is free text.
- [ ] Created Interaction uses `parsedDate` (UTC-Z) as `occurredAt`, `parsedType ?? 'meeting'` as `type`, `parsedSummary` as `summary`, `parsedLocation` as `location`.
- [ ] Returns 400 if the entry's `matchState` is `parse_error`.
- [ ] Returns 400 if the entry's `status` is not `pending` (already resolved or discarded).
- [ ] Returns 400 if the supplied `contactId` does not reference a non-deleted contact.
- [ ] Returns 400 for extra fields in the request body (strict mode).
- [ ] Returns 404 for a nonexistent entry id.

### PATCH /api/inbox/:id/discard

- [ ] Sets `status: 'discarded'` and returns 200 with the updated InboxEntry.
- [ ] Accepts `matchState: 'parse_error'` entries — discard is the only valid resolution for parse errors.
- [ ] Accepts `matchState: 'ambiguous'` and `matchState: 'unmatched'` entries.
- [ ] Returns 400 if the entry's `status` is not `pending` (already resolved or discarded).
- [ ] Returns 404 for a nonexistent entry id.

### Apple Shortcut documentation

- [ ] `docs/inbox-shortcut-setup.md` exists and covers: prerequisites, step-by-step Shortcut construction (including GUID-based `id` generation and ISO 8601 offset date formatting), the exact output format the Shortcut produces, voice dictation tips, and iPhone installation steps.

---

## Session 2

### Client: /inbox page

- [ ] "Process inbox" button calls `POST /api/inbox/process` and shows an inline result after completion: `"Processed N interaction(s), queued M for review"`.
- [ ] Queue list is fetched on mount via `GET /api/inbox` and re-fetched after each process run.
- [ ] Loading state shown while fetching the queue.
- [ ] Empty state: "Inbox is empty." when no pending entries exist.
- [ ] Each entry card shows: `parsedContact`, type label, formatted `parsedDate` in local timezone, and first 80 characters of `parsedSummary` truncated with "…" if longer.
- [ ] `parse_error` entries display the `parseError` message and `rawText` in a preformatted block; only "Discard" is rendered (no "Resolve" button).
- [ ] `ambiguous` entries display candidate contact names; "Resolve" opens the resolve modal.
- [ ] `unmatched` entries display "No match found for '{parsedContact}'"; "Resolve" opens the resolve modal.
- [ ] Resolve modal: contact name search filters the contact list; selecting a contact and submitting calls `resolveInboxEntry`; entry disappears from queue on success.
- [ ] ApiError 400 from the resolve endpoint shows an inline error inside the resolve modal; does not propagate to ErrorBoundary.
- [ ] Non-400 errors from resolve propagate to ErrorBoundary.
- [ ] Discard button calls `discardInboxEntry`; entry disappears from queue on success. No confirmation modal.
- [ ] Errors during initial fetch or process run propagate to ErrorBoundary.
