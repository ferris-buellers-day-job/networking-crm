# Sprint 08 — Reminders

## Goal

Ship the reminder entity and its primary UI. After this sprint:

- David can create a reminder anchored to a contact, with a due date and optional note.
- A `/reminders` page lists all pending reminders sorted soonest-first, with overdue reminders visually distinguished.
- David can mark a reminder done or delete it from that page.
- Deleting a contact cascade-soft-deletes its pending reminders (done reminders are preserved as completed history).
- ADR 017 records the general cascade soft-delete policy for all contact-anchored child entities, generalizing ADR 013.

ICS/email reminder delivery (sequence item 11) is **not** part of this sprint.

## Scope (what's in)

### 1. ReminderSchema and FileStore wiring

`server/schemas/reminder.ts`:

```typescript
export const REMINDER_SCHEMA_VERSION = 1;

export const ReminderSchema = BaseRecordSchema.extend({
  contactId: z.string().uuid(),
  dueAt:     z.string().datetime(),
  status:    z.enum(['pending', 'done']),
  note:      z.string().max(500).nullable(),
});

export type Reminder = z.infer<typeof ReminderSchema>;
```

**`status` and `deletedAt` are orthogonal.** This is load-bearing and must never be conflated:

- `status: 'done'` means the user completed the follow-up. `deletedAt` remains `null`. The record is completed history.
- `deletedAt` set means the record was soft-deleted — either directly by the user or by contact cascade. `status` at the time of deletion is preserved as-is (typically `'pending'`).
- A done reminder and a cascade-deleted reminder are distinguishable on disk: `{status:'done', deletedAt:null}` vs `{status:'pending', deletedAt:'<timestamp>'}`.
- The `/reminders` pending query is `status === 'pending' && deletedAt === null`. Done reminders are excluded by status. Cascade-deleted reminders are excluded by `deletedAt`.

**FileStore wiring** (`server/services/storage.ts`):

- Add `reminderStore: FileStore<Reminder>` to `StorageContext`.
- Construct with `{ expectedSchemaVersion: REMINDER_SCHEMA_VERSION }`.
- Reminders stored at `DATA_PATH/reminders/`.

Wire `createRemindersRouter` into `server/index.ts`.

Update `docs/data-schema.md` to add the Reminder entity table.

### 2. Contact cascade soft-delete extension

`server/routes/contacts.ts` — extend the existing `DELETE /api/contacts/:id` handler to also cascade to reminders, following the ADR 013 / ADR 017 write-order:

1. Soft-delete all active interactions (`deletedAt === null`) for the contact — already implemented.
2. **NEW:** Soft-delete all `status === 'pending' && deletedAt === null` reminders for the contact.
3. Soft-delete the contact itself.

Done reminders (`status: 'done'`, `deletedAt: null`) are **not** cascade-deleted. They are completed history and must survive contact deletion.

Partial failure at any step leaves the contact active and the full cascade retryable, per ADR 013 / ADR 017.

### 3. POST /api/reminders — create

Request body (strict — extra fields return 400):

```typescript
interface CreateReminderBody {
  contactId: string;  // UUID of a non-deleted contact
  dueAt:     string;  // UTC ISO 8601 datetime
  note?:     string | null;
}
```

- Validates `contactId` references a non-deleted, non-quarantined contact (ADR 006 §10). Returns 400 if the contact does not exist or is soft-deleted.
- `dueAt` must be a valid ISO 8601 datetime string (Zod `.datetime()` — requires UTC Z or offset). Returns 400 if invalid.
- `status` defaults to `'pending'` — the client never sets it at creation.
- `note` stored as `null` when omitted or null; trimmed if provided.
- Returns 201 with `{ reminder: Reminder }`.

### 4. GET /api/reminders — list pending

Returns all reminders where `status === 'pending' && deletedAt === null`, sorted by `dueAt` ascending (soonest due first).

Response: `{ reminders: Reminder[] }`.

No query parameters. No server-side enrichment (contact names are resolved client-side from a parallel `/api/contacts` fetch). Done reminders and cascade-deleted reminders are not returned.

### 5. PATCH /api/reminders/:id/done — mark done

Sets `status: 'done'`, leaves `deletedAt: null`.

- Returns 200 with `{ reminder: Reminder }`.
- Returns 400 if `status` is already `'done'`.
- Returns 400 if `deletedAt` is set (the reminder has been soft-deleted and cannot be marked done).
- Returns 404 for a nonexistent id.
- Body must be `{}` (strict — extra fields return 400).

### 6. DELETE /api/reminders/:id — soft-delete

Direct soft-delete (user initiated, distinct from contact cascade). Sets `deletedAt`.

- Returns 204.
- Returns 400 if `deletedAt` is already set.
- Returns 404 for a nonexistent id.

### 7. Shared ContactPicker component — extract from ResolveInboxModal

`client/components/resolve-inbox-modal.tsx` already implements client-side contact search and selection (type → filter by name/preferredName → click to select). The `/reminders` create form needs identical capability.

**Decision: extract into `client/components/contact-picker.tsx`.** Two independent pickers would immediately drift (different edge cases, different empty states, different keyboard handling). Extract is the correct choice. This is a deliberate, flagged refactor of a Sprint-06 file.

`ContactPicker` props:

```typescript
interface ContactPickerProps {
  contacts:         Contact[];      // pre-fetched contact list
  selectedContact:  Contact | null;
  onSelect:         (contact: Contact | null) => void;
}
```

Behavior:
- Text input filters `contacts` by `name` and `preferredName` (case-insensitive, same logic currently in `ResolveInboxModal`).
- Matching contacts rendered as a list of selectable buttons.
- Selecting a contact calls `onSelect(contact)` and shows "Selected: {name}" (clearing the search results).
- Clearing the selected contact (via typing again or an explicit clear) calls `onSelect(null)`.
- Empty query: no results shown (same as current modal behavior).
- Query with no matches: shows "No contacts match."

`ResolveInboxModal` is updated to use `ContactPicker` internally, passing its already-fetched `contacts` state. The modal's external behavior (props, `onResolved` callback) is unchanged — all existing tests must continue to pass without modification.

`contact-picker.test.tsx` covers the extracted component in isolation. `resolve-inbox-modal.test.tsx` must continue to pass as-is (integration proof that the refactor preserved behavior).

### 8. /reminders page — list, overdue display, create form, mark done, delete

`client/pages/reminders.tsx`, route `/reminders` (added to `client/app.tsx`).

**On mount:** fetch `/api/reminders` and `/api/contacts` in parallel. Show loading state until both resolve. Errors propagate to ErrorBoundary.

**Contact name resolution:** build a `Map<string, Contact>` from the fetched contacts. Render each reminder row's contact name by looking up `reminder.contactId` in the map. If a contact is not found (e.g. data inconsistency), display "(unknown contact)".

**List:**
- Empty state: "No pending reminders."
- Each row displays: contact name (linked to `/contacts/:id`), note (if non-null), `dueAt` formatted in local timezone via `Date.toLocaleString()` or equivalent.
- **Overdue indicator:** computed at render time as `new Date(reminder.dueAt) < new Date()`. This comparison operates on absolute epoch milliseconds — both sides resolve to the same time basis regardless of timezone, so it correctly reflects the local clock. The timezone matters only for display formatting of `dueAt`, not for the overdue comparison itself. Apply CSS class `.reminder-overdue` to overdue rows; do not persist `isOverdue` anywhere.
- "Mark done" button per row: calls `PATCH /api/reminders/:id/done`, removes entry from list in place on success.
- "Delete" button per row: calls `DELETE /api/reminders/:id`, removes entry from list in place on success.
- Both actions' errors propagate to ErrorBoundary.

**Create form (inline toggle):**
- "Add reminder" button toggles the form visible/hidden.
- Fields:
  - `ContactPicker` (required — Submit disabled until a contact is selected). Receives the already-fetched contacts list; no second fetch.
  - `<input type="datetime-local">` for `dueAt` (required). The `datetime-local` input captures local time as a string (e.g. `"2026-08-20T17:00"`). Before POSTing, convert to UTC ISO: `new Date(inputValue).toISOString()`. This is the UTC-store boundary: local input → UTC wire format.
  - `<input type="text">` for `note` (optional, max 500 chars, client-side length hint but server enforces).
- On submit: POST to `/api/reminders`. On success: prepend the new reminder to the list (or re-sort by `dueAt`), reset the form, and hide it.
- ApiError 400 shown inline inside the form; other errors propagate to ErrorBoundary.

### 9. ADR 017 — General cascade soft-delete policy for contact-anchored entities

`docs/decisions/017-cascade-soft-delete-policy.md`:

**Context:** ADR 013 established the write-order invariant for the first contact-anchored child entity (Interaction): cascade-soft-delete children before the contact, so partial failure leaves the contact active and the full cascade retryable. Reminders are the second contact-anchored entity. Rather than duplicate the ADR 013 reasoning per entity, generalize it.

**Decision:** Any entity with a `contactId` foreign key is a contact-anchored child entity. When a contact is soft-deleted, all its non-deleted child records are soft-deleted first, in an explicit sequence, before the contact's own soft-delete is written. The sequence:

1. Interactions (`deletedAt === null`)
2. Reminders (`status === 'pending' && deletedAt === null`)
3. Contact

Done reminders (`status === 'done'`, `deletedAt === null`) are excluded from cascade: they are completed history, not active records.

If any step in the cascade fails, the contact's `deletedAt` is not written — the contact remains active and the full cascade is retryable with no risk of orphaned child records. This is the ADR 013 invariant generalized.

Future contact-anchored entities (e.g. action items) must be added to the cascade sequence in this policy before shipping.

ADR 017 references ADR 013 as the origin and inherits its write-order rationale. ADR 013 is **not** edited — it is the historical record of the interaction-specific decision.

## Scope (explicitly out)

- ICS/email reminder batching (sequence item 11) — reminders are stored, not delivered
- Snooze (extend `dueAt` and reschedule a pending reminder)
- Dismissed state (separate from done)
- Un-done (reverting a completed reminder to pending)
- Recurring reminders
- Reminder editing (note or dueAt change after creation)
- Contact detail page reminder widget — add to backlog
- Nav due/overdue count badge — add to backlog
- `sourceInteractionId` created-from metadata
- Bulk mark-done
- `GET /api/reminders/:id` (single reminder by id) — add to backlog

## Directory layout (target additions)

```
server/
├── schemas/
│   └── reminder.ts                (ReminderSchema, REMINDER_SCHEMA_VERSION)
├── routes/
│   ├── reminders.ts               (POST /, GET /, PATCH /:id/done, DELETE /:id)
│   └── reminders.test.ts
└── services/
    └── storage.ts                 (add reminderStore to StorageContext)

client/
├── lib/
│   └── reminders-api.ts           (createReminder, fetchReminders, markReminderDone, deleteReminder)
├── components/
│   ├── contact-picker.tsx         (extracted from resolve-inbox-modal.tsx — new file)
│   ├── contact-picker.test.tsx    (new)
│   └── resolve-inbox-modal.tsx    (updated to use ContactPicker — Sprint 06 file)
└── pages/
    ├── reminders.tsx              (/reminders route)
    └── reminders.test.tsx

docs/
└── decisions/
    └── 017-cascade-soft-delete-policy.md   (new)

Also modified:
  server/routes/contacts.ts        (cascade pending reminders on contact delete)
  server/routes/contacts.test.ts   (cascade + orthogonality tests)
  server/index.ts                  (wire createRemindersRouter)
  client/app.tsx                   (add /reminders route)
  docs/data-schema.md              (add Reminder entity table)
```

## Interfaces

```typescript
// server/schemas/reminder.ts
export const REMINDER_SCHEMA_VERSION = 1;

export const ReminderSchema = BaseRecordSchema.extend({
  contactId: z.string().uuid(),
  dueAt:     z.string().datetime(),
  status:    z.enum(['pending', 'done']),
  note:      z.string().max(500).nullable(),
});

export type Reminder = z.infer<typeof ReminderSchema>;

// API response shapes
interface ReminderListResponse { reminders: Reminder[]; }
interface ReminderResponse     { reminder: Reminder; }

// POST /api/reminders body (strict)
interface CreateReminderBody {
  contactId: string;
  dueAt:     string;   // UTC ISO 8601; client converts datetime-local → UTC
  note?:     string | null;
}

// client/lib/reminders-api.ts
export function createReminder(body: CreateReminderBody): Promise<ReminderResponse>
export function fetchReminders(): Promise<ReminderListResponse>
export function markReminderDone(id: string): Promise<ReminderResponse>
export function deleteReminder(id: string): Promise<void>
```

## Backlog additions

Add to `backlog.md`:

- [ ] Interaction-anchored reminders — link a reminder to a specific interaction (optional `sourceInteractionId` field)
- [ ] Dismissed state — "I won't do this" (semantically distinct from done)
- [ ] Snoozed/reschedule — update `dueAt` on a pending reminder ("remind me again in 2 weeks")
- [ ] Un-done — revert a completed reminder to pending
- [ ] Contact detail page reminder widget — create and list reminders from within the contact detail page
- [ ] Nav due/overdue count badge — real-time indicator of how many reminders are overdue
- [ ] `GET /api/reminders/:id` — single reminder endpoint
- [ ] Reminder editing (change note or dueAt after creation)
- [ ] Bulk mark-done for overdue reminders
- [ ] Recurring reminders

## Acceptance criteria

See `acceptance.md`.

## Session prompts

- *Session 1:* "Read CLAUDE.md, then specs/sprint-08-reminders/spec.md. Implement Sections 1–6 and Section 9 in order: ReminderSchema + FileStore wiring (Section 1), contact cascade extension (Section 2), POST route (Section 3), GET route (Section 4), PATCH done route (Section 5), DELETE route (Section 6), and ADR 017 (Section 9). Update server/services/storage.ts, server/index.ts, server/routes/contacts.ts, and docs/data-schema.md. Do not implement client code (Sections 7–8) yet."

- *Session 2:* "Read CLAUDE.md, then specs/sprint-08-reminders/spec.md Sections 7–8 only. Session 1 (schema, routes, cascade, ADR 017) is already committed. Implement: ContactPicker extraction + ResolveInboxModal refactor (Section 7), reminders-api.ts client module, /reminders page (Section 8), and all client tests. Add the /reminders route to client/app.tsx."
