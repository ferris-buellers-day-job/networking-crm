# Sprint 08 — Acceptance Criteria

## Session 1

### Schema and FileStore wiring

- [x] `REMINDER_SCHEMA_VERSION = 1` is exported from `server/schemas/reminder.ts`. *(code-existence check: verified)*
- [x] `ReminderSchema` has all required fields: `contactId` (uuid string), `dueAt` (datetime string), `status` (enum `'pending' | 'done'`), `note` (nullable string max 500), plus the standard base fields (`id`, `createdAt`, `updatedAt`, `deletedAt`, `schemaVersion`).
- [x] `reminderStore` (`FileStore<Reminder>`) is constructed in `server/services/storage.ts` with `expectedSchemaVersion: REMINDER_SCHEMA_VERSION`. *(code-existence check: verified)*
- [x] The reminders router is wired into `server/index.ts` at `/api/reminders`. *(code-existence check: verified)*

### ADR 017

- [x] `docs/decisions/017-cascade-soft-delete-policy.md` exists and covers: the write-order invariant (children before contact), which child record types cascade (non-deleted records only), that done reminders are excluded from cascade, and that ADR 013 is the origin this ADR generalizes. *(doc-existence check: verified)*

### POST /api/reminders

- [x] Creating a reminder with valid `contactId`, `dueAt`, and no `note` returns 201 with `status: 'pending'` and `note: null`.
- [x] Creating a reminder with a `note` value stores and returns the note.
- [x] The returned reminder has `deletedAt: null` — status and deletedAt are independent fields from the first write.
- [x] Returns 400 if `contactId` references a non-existent contact.
- [x] Returns 400 if `contactId` references a soft-deleted contact.
- [x] Returns 400 if `dueAt` is not a valid ISO 8601 datetime string.
- [x] Returns 400 for extra fields in the request body (strict mode).

### dueAt UTC boundary (server enforcement)

- [x] Returns 400 if `dueAt` is an offset-bearing string (e.g. `'2026-08-20T17:00:00-06:00'`) — Zod's `z.string().datetime()` enforces Z-suffix UTC; local→UTC conversion is the client's responsibility. *(server test: "returns 400 if dueAt is an offset-bearing string")*
- [x] Returns 400 if `dueAt` is a bare local string with no timezone (e.g. `'2026-08-20T17:00:00'`). *(server test: "returns 400 if dueAt is a bare local string with no zone")*

### GET /api/reminders

- [x] Returns `{ reminders: [] }` when no pending reminders exist.
- [x] Returns only reminders where `status === 'pending'` and `deletedAt === null`.
- [x] Results are sorted by `dueAt` ascending (soonest first).
- [x] Does not return reminders with `status: 'done'`.
- [x] Does not return reminders with `deletedAt` set.

### PATCH /api/reminders/:id/done

- [x] Sets `status: 'done'` and returns 200 with the updated reminder; `deletedAt` remains `null`.
- [x] Returns 400 if the reminder's `status` is already `'done'`.
- [x] Returns 400 if the reminder's `deletedAt` is set (already soft-deleted).
- [x] Returns 404 for a nonexistent reminder id.
- [x] Returns 400 for extra fields in the request body.

### DELETE /api/reminders/:id

- [x] Sets `deletedAt` to a UTC timestamp and returns 204.
- [x] Returns 400 if `deletedAt` is already set (idempotent delete not supported — second delete is a 400).
- [x] Returns 404 for a nonexistent reminder id.

### Contact cascade soft-delete extension

- [x] Deleting a contact also soft-deletes its `status === 'pending'` and `deletedAt === null` reminders (sets `deletedAt` on those reminders).
- [x] Done reminders (`status === 'done'`, `deletedAt === null`) for the deleted contact are **not** cascade-deleted — they remain on disk with `deletedAt: null`.
- [x] **status/deletedAt orthogonality:** Create two reminders for one contact; mark one done (via PATCH done), leave the other pending. Delete the contact. Assert the exact end-states on both reminders: the done reminder has `status: 'done'` AND `deletedAt: null` (completed history, untouched by cascade); the pending reminder has `status: 'pending'` AND `deletedAt` set to a non-null UTC timestamp (cascade-deleted). All four field values must be explicitly asserted — asserting only `deletedAt` is insufficient.
- [x] Write-order invariant: if the reminder cascade write fails (simulated), the contact's `deletedAt` is not set — the contact remains active and the cascade is retryable.
- [x] The contact cascade continues to soft-delete interactions first, then pending reminders, then the contact (existing interaction cascade tests continue to pass).

---

## Session 2

### ContactPicker component (extracted)

- [x] `client/components/contact-picker.tsx` exists as a standalone component accepting `contacts`, `selectedContact`, and `onSelect` props.
- [x] Typing in the search input filters `contacts` by `name` and `preferredName` (case-insensitive); only matching contacts appear.
- [x] Clicking a result calls `onSelect(contact)` and shows "Selected: {name}"; the results list is hidden.
- [x] Typing again after selection clears `selectedContact` (calls `onSelect(null)`) and re-shows filtered results.
- [x] A query with no matching contacts shows "No contacts match."
- [x] An empty query shows no results.
- [x] All existing `resolve-inbox-modal.test.tsx` tests continue to pass without modification. Specifically, the modal→page boundary test (`'successful resolve removes the entry from the queue'` in `inbox.test.tsx`) must pass — this test exercises the `onResolved(entry)` callback path through the mocked modal, which is the highest-risk path for the ContactPicker extraction to silently break. ResolveInboxModal's props (`entryId`, `isOpen`, `onClose`, `onResolved`) are unchanged; no test refactoring is permitted as part of this extraction.

### client reminders API module

- [x] `client/lib/reminders-api.ts` exports: `createReminder`, `fetchReminders`, `markReminderDone`, `deleteReminder`, and a `Reminder` interface matching the server schema.

### /reminders page — loading and empty states

- [x] The page fetches `/api/reminders` and `/api/contacts` in parallel on mount; loading state is shown until both resolve.
- [x] Empty state: "No pending reminders." when the reminders list is empty.

### /reminders page — list display

- [x] Each pending reminder row shows the contact's display name linked to `/contacts/:id`.
- [x] Each row shows the note if non-null; no note field shown when note is null.
- [x] Each row shows `dueAt` formatted in local timezone.
- [x] **Overdue rendering:** a reminder whose `dueAt` represents an instant in the past receives the `.reminder-overdue` CSS class; a reminder whose `dueAt` represents an instant in the future does not. The comparison is `new Date(reminder.dueAt) < new Date()`: both operands are absolute instants resolved to epoch milliseconds — `new Date(utcString)` converts the stored UTC string to an epoch value; `new Date()` is the current epoch value. Local timezone does not enter the comparison; it enters only the display formatting of `dueAt`. No `isOverdue` field is stored or returned in any API response.
- [x] **Future-UTC-instant guard (5pm-local-vs-5pm-UTC bug class):** A reminder with `dueAt` set to a UTC instant that is strictly in the future — i.e. `new Date(dueAt) > new Date()` — must NOT receive the `.reminder-overdue` class, regardless of how that UTC instant maps to local wall-clock time. Test by mocking the current time to a fixed instant T and asserting: a reminder with `dueAt` = T+1ms is not overdue; a reminder with `dueAt` = T-1ms is overdue. Both `dueAt` values are UTC ISO strings. This guards against any implementation that compares a local-formatted string or a local hour-of-day rather than epoch milliseconds.
- [x] Fetch errors propagate to ErrorBoundary.

### /reminders page — mark done

- [x] Clicking "Mark done" on a pending reminder calls `PATCH /api/reminders/:id/done`; on success the entry is removed from the list in place.
- [x] Errors from mark-done propagate to ErrorBoundary.

### /reminders page — delete

- [x] Clicking "Delete" on a reminder calls `DELETE /api/reminders/:id`; on success the entry is removed from the list in place.
- [x] Errors from delete propagate to ErrorBoundary.

### /reminders page — create form

- [x] "Add reminder" button toggles an inline create form.
- [x] The create form uses `ContactPicker` for contact selection, sourced from the contacts already fetched on mount (no second fetch).
- [x] The Submit button is disabled until a contact is selected and a `dueAt` value is entered.
- [x] The `datetime-local` input value is converted to UTC ISO string (`new Date(inputValue).toISOString()`) before posting — the wire format is always UTC.
- [x] On successful create: the new reminder is added to the list (correctly positioned by `dueAt` or re-sorted), the form resets and hides.
- [x] ApiError 400 from the create endpoint shows an inline error inside the form; other errors propagate to ErrorBoundary.
