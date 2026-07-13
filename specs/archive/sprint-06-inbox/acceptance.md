# Sprint 06 — Acceptance Criteria

## Session 1

### Inbox format and parser

- [x] Parser correctly parses a complete valid entry with all fields, including a multi-line summary spanning multiple lines.
- [x] Parser returns a `ParsedEntry` with `parseError` set when `id` is missing.
- [x] Parser returns a `ParsedEntry` with `parseError` set when `id` is present but does not match `[0-9a-fA-F]{8}`.
- [x] Parser returns a `ParsedEntry` with `parseError` set when `date` is missing.
- [x] Parser returns a `ParsedEntry` with `parseError` set when `date` is present but does not match the strict ISO 8601 pattern (date + time + offset or Z required).
- [x] A loosely-formatted but non-ISO date value (e.g. `"June 28 2026"`) is treated as a `parse_error` — not coerced to a timestamp.
- [x] Parser returns a `ParsedEntry` with `parseError` set when `contact` is missing or empty after trimming.
- [x] Parser returns a `ParsedEntry` with `parseError` set for an unclosed block (opening `---` with no closing `---` before EOF or the next opening `---`).
- [x] Parser defaults `parsedType` to `'meeting'` when the `type` field is absent — no parse error.
- [x] Parser defaults `parsedType` to `'meeting'` when the `type` field contains an unrecognized value — no parse error.
- [x] Parser sets `parsedLocation = null` for an entry with no `location` field — no parse error.
- [x] Parser sets `parsedSummary = null` for an entry with no `summary` field — no parse error.
- [x] **Date UTC conversion:** parser converts an offset-bearing `date` value (`2026-06-28T15:30:00-07:00`) to `parsedDate = '2026-06-28T22:30:00.000Z'`. `parsedDate` always stores the UTC-Z form.
- [x] A minute-precision ISO string with offset and no seconds (e.g. `2026-06-28T15:30-07:00`) parses successfully (not a parse error) and converts to the correct UTC-Z value (`2026-06-28T22:30:00.000Z`).
- [x] `INBOX_ENTRY_SCHEMA_VERSION = 1` is exported from `server/schemas/inbox-entry.ts`. *(code-existence check: verified by grep)*
- [x] FileStore for inbox entries is constructed with `expectedSchemaVersion: INBOX_ENTRY_SCHEMA_VERSION`. *(code-existence check: verified in `server/services/storage.ts:202`)*

### POST /api/inbox/process

- [x] Returns `{ processed: 0, queued: 0 }` when `inbox.txt` is empty or absent.
- [x] Auto-matched entry (exactly one contact name match) creates both an Interaction and an InboxEntry with `status: 'resolved'`, `matchState: 'auto_matched'`, `interactionId` set.
- [x] Ambiguous entry (2+ contact name matches) creates an InboxEntry with `status: 'pending'`, `matchState: 'ambiguous'`, and `candidateContactIds` populated with the matching contact UUIDs.
- [x] Unmatched entry (0 contact name matches) creates an InboxEntry with `status: 'pending'`, `matchState: 'unmatched'`.
- [x] Parse-error entry creates an InboxEntry with `status: 'pending'`, `matchState: 'parse_error'`, `parseError` message set.
- [x] Re-running `POST /api/inbox/process` on the same `inbox.txt` creates no duplicate InboxEntry or Interaction records — rawId idempotency applies uniformly to all `matchState` values (`auto_matched`, `ambiguous`, `unmatched`, `parse_error`).
- [x] On a re-run where entries are skipped via rawId, those skipped entries are NOT re-appended to `inbox-processed.txt` (no duplicate audit lines).
- [x] **Byte-level truncation / concurrent-append safety:** a non-ASCII entry (e.g. contact name "José García" containing multibyte UTF-8 characters) appended to `inbox.txt` after the initial Buffer read — simulated in a test by writing additional bytes to the file between the read and the write-back — survives the process run intact in `inbox.txt` and is not corrupted or lost.
- [x] Processed entries' `rawText` is appended to `inbox-processed.txt` after a run. *(covered implicitly by idempotency test at `inbox.test.ts:275`: asserts one occurrence in audit log after first run)*
- [x] After a successful run, `inbox.txt` contains only content appended after the initial read (empty if nothing new was appended).

### GET /api/inbox

- [x] Returns `{ entries: [] }` when no pending InboxEntry records exist.
- [x] Returns only entries with `status: 'pending'`, sorted by `createdAt` ascending (oldest first).
- [x] Does not return entries with `status: 'resolved'` or `status: 'discarded'`.

### PATCH /api/inbox/:id/resolve

- [x] Creates an Interaction from the entry's parsed fields and returns 200 with the updated InboxEntry.
- [x] Sets `status: 'resolved'`, `contactId`, and `interactionId` on the InboxEntry.
- [x] The created Interaction's `contactId` is the `contactId` supplied in the PATCH body (the user's explicit resolution choice) — NOT derived from `parsedContact`, which is free text.
- [x] Created Interaction uses `parsedDate` (UTC-Z) as `occurredAt`, `parsedType ?? 'meeting'` as `type`, `parsedSummary` as `summary`, `parsedLocation` as `location`.
- [x] Returns 400 if the entry's `matchState` is `parse_error`.
- [x] Returns 400 if the entry's `status` is not `pending` (already resolved or discarded).
- [x] Returns 400 if the supplied `contactId` does not reference a non-deleted contact.
- [x] Returns 400 for extra fields in the request body (strict mode).
- [x] Returns 404 for a nonexistent entry id.

### PATCH /api/inbox/:id/discard

- [x] Sets `status: 'discarded'` and returns 200 with the updated InboxEntry.
- [x] Accepts `matchState: 'parse_error'` entries — discard is the only valid resolution for parse errors.
- [x] Accepts `matchState: 'ambiguous'` and `matchState: 'unmatched'` entries.
- [x] Returns 400 if the entry's `status` is not `pending` (already resolved or discarded).
- [x] Returns 404 for a nonexistent entry id.

### Apple Shortcut documentation

- [x] `docs/inbox-shortcut-setup.md` exists and covers: prerequisites, step-by-step Shortcut construction (including GUID-based `id` generation and ISO 8601 offset date formatting), the exact output format the Shortcut produces, voice dictation tips, and iPhone installation steps. *(doc-existence check: all sections verified)*

---

## Session 2

### Client: /inbox page

- [x] "Process inbox" button calls `POST /api/inbox/process` and shows an inline result after completion: `"Processed N interaction(s), queued M for review"`.
- [x] Queue list is fetched on mount via `GET /api/inbox` and re-fetched after each process run.
- [x] Loading state shown while fetching the queue.
- [x] Empty state: "Inbox is empty." when no pending entries exist.
- [ ] Each entry card shows: `parsedContact`, type label, formatted `parsedDate` in local timezone, and first 80 characters of `parsedSummary` truncated with "…" if longer.
  > **FLAG:** `parsedContact` and type label are tested (`inbox.test.tsx:126`). `parsedDate` locale formatting is rendered but not asserted. `parsedSummary` 80-char truncation has no test.
- [x] `parse_error` entries display the `parseError` message and `rawText` in a preformatted block; only "Discard" is rendered (no "Resolve" button).
- [x] `ambiguous` entries display candidate contact names; "Resolve" opens the resolve modal.
- [x] `unmatched` entries display "No match found for '{parsedContact}'"; "Resolve" opens the resolve modal.
- [x] Resolve modal: contact name search filters the contact list; selecting a contact and submitting calls `resolveInboxEntry`; entry disappears from queue on success.
- [x] ApiError 400 from the resolve endpoint shows an inline error inside the resolve modal; does not propagate to ErrorBoundary.
- [x] Non-400 errors from resolve propagate to ErrorBoundary.
- [x] Discard button calls `discardInboxEntry`; entry disappears from queue on success. No confirmation modal.
- [x] Errors during initial fetch or process run propagate to ErrorBoundary.
