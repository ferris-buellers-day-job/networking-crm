# Sprint 05 — Interactions

## Goal

Implement the Interaction entity — the event log that makes contacts meaningful. After this sprint:
- Every professional conversation can be logged manually from the Mac UI.
- Contact detail pages show a chronological timeline of past interactions, expandable inline.
- Soft-deleting a contact cascades the deletion to all of its interactions.

Inbox capture (inbox.txt, Apple Shortcut, inbox parser, review queue) is deferred to Sprint 06, which will ship the full inbox flow coherently alongside review queue UI and Apple Shortcut documentation.

## Scope (what's in)

### 1. Interaction schema and validation

```typescript
// server/schemas/interaction.ts

export const INTERACTION_SCHEMA_VERSION = 1;

export const InteractionSchema = BaseRecordSchema.extend({
  contactId:  z.string().uuid(),
  occurredAt: z.string().datetime(),
  type:       z.enum(['meeting', 'call', 'email', 'message', 'other']),
  summary:    z.string().max(10000).nullable(),
  location:   z.string().max(200).nullable(),
});

export type Interaction = z.infer<typeof InteractionSchema>;
```

**Type enum semantics:**
- `meeting` — in-person or video meeting (Zoom, Meet, FaceTime, etc.)
- `call` — voice-only phone or VoIP call
- `email` — email exchange (single message or thread)
- `message` — text/SMS/Slack/DM/any async text channel
- `other` — anything that doesn't fit the above

**Field rules:**
- `contactId`: Required. UUID. Must reference a non-soft-deleted Contact at create time (see Section 3).
- `occurredAt`: Required. UTC ISO 8601 with `Z` suffix. Represents when the interaction happened — may predate `createdAt` when logging retroactively.
- `type`: Required. Enum above.
- `summary`: Optional (nullable). Freeform text, max 10,000 characters.
- `location`: Optional (nullable). Physical or virtual location string (e.g., "Blue Bottle, Oakland" or "Zoom"), max 200 characters.

**Not included (deferred):**
- Metadata/tags field — YAGNI. Add to backlog.

### 2. Storage wiring

Add `interactionsStore` to `StorageContext` and `initStorage()`.

```typescript
// In server/services/storage.ts

import { InteractionSchema, INTERACTION_SCHEMA_VERSION } from '../schemas/interaction.js';

const interactionsStore = new FileStore<Interaction>(
  path.join(dataPath, 'interactions'),
  InteractionSchema,
  { cacheDb, logger, recentWrites },
  { expectedSchemaVersion: INTERACTION_SCHEMA_VERSION }
);
```

Interaction JSON files live at `DATA_PATH/interactions/{id}.json`. Same `{id}.json` naming pattern as contacts (per ADR 006: `id` is authoritative, no slug in filename).

Update `StorageContext` interface to expose `interactionsStore: FileStore<Interaction>`.

**ContactsRouterDeps change (Sprint 04 file, Sprint 05 work):** `server/routes/contacts.ts` is a Sprint 04 file. Sprint 05 adds `interactionsStore: FileStore<Interaction>` to `ContactsRouterDeps` to support cascade soft-delete (Section 4). Update `server/index.ts` to pass `interactionsStore` when constructing the contacts router.

### 3. Interaction API endpoints

```
GET    /api/interactions?contactId=:id   // List non-deleted interactions for a contact
POST   /api/interactions                 // Create interaction
DELETE /api/interactions/:id             // Soft-delete interaction
```

Wire via `createInteractionsRouter({ interactionsStore, contactsStore })` in `server/index.ts`.

No `GET /api/interactions/:id` or `PUT /api/interactions/:id` in Sprint 05 — add both to backlog.

**GET /api/interactions?contactId=:id**
- `contactId` query param is required. Return 400 ValidationError if missing.
- Returns `{ interactions: Interaction[] }` — only records where `deletedAt === null` and `contactId` matches, sorted by `occurredAt` descending.
- Implementation: `interactionsStore.getAll()` + in-memory filter + sort. Acceptable at personal scale.
- Does NOT validate whether the referenced contact exists or is active — caller's responsibility.
- Returns 200 with empty array if no matching interactions.

**POST /api/interactions**
- Body: `{ contactId, occurredAt, type, summary?, location? }`. Strict: reject extra fields.
- Validate `contactId` references a non-soft-deleted contact: call `contactsStore.get(contactId)`. If the result is null or `deletedAt !== null`, throw `ValidationError("Contact not found or deleted", { op: 'interactions.create' })` → 400.
- Generate UUID. Set `createdAt`, `updatedAt`, `deletedAt: null`, `schemaVersion`.
- Response: `{ interaction: Interaction }` with 201 status.

**DELETE /api/interactions/:id**
- Soft-delete: set `deletedAt` and `updatedAt` to current timestamp.
- 404 if not found, already deleted, or quarantined. Response shape: `{ error: { type: 'NotFound', message: 'Interaction not found' } }` (same pattern as contacts).
- Response: 204 No Content.

### 4. Contact soft-delete cascade

Modify `DELETE /api/contacts/:id` to cascade the soft-deletion to all of that contact's active interactions.

`ContactsRouterDeps` gains `interactionsStore: FileStore<Interaction>`.

**Updated handler logic:**
1. Load and validate contact (existing 404 checks unchanged).
2. Compute `now = new Date().toISOString()`.
3. Load all active interactions: `interactionsStore.getAll()` filtered by `contactId === id` and `deletedAt === null`.
4. For each matching interaction: save with `deletedAt: now` and `updatedAt: now`.
5. Save the contact with `deletedAt: now` and `updatedAt: now`.
6. Respond 204.

**Write order rationale:** Interactions are written before the contact (steps 4 then 5) intentionally. If the cascade fails partway, interactions are deleted but the contact remains active — a retry will complete the cascade. The alternative (contact first) would leave orphaned interactions visible against a deleted contact, which is worse.

**Error handling:** If any interaction write in step 4 throws (expected error type: `StorageError`), the handler rethrows and the request returns 500. The contact's `deletedAt` is NOT set — the contact remains active. Any interactions already written in that step remain deleted (idempotent: step 3's filter will skip them on a subsequent retry). Document this as acceptable at personal scale; add atomic group-write to backlog.

**Idempotency:** A second `DELETE /api/contacts/:id` on an already-deleted contact returns 404 (existing behavior — the 404 check at step 1 catches it). No new behavior needed; verify via test.

**Test cases to add to `server/routes/contacts.test.ts`:**
- Contact with no interactions → 204, contact has `deletedAt`, no interaction errors.
- Contact with 2 active interactions → 204, contact and both interactions share the same `deletedAt` timestamp.
- Contact with 1 active and 1 already-deleted interaction → only the active interaction is cascaded; the deleted one is not re-written.
- Interaction write fails during cascade → response is 500, re-fetch contact confirms `deletedAt` is still null. (Implement by spying on `interactionsStore.save` to throw a `StorageError`.)
- Second DELETE on the same contact (already deleted) → 404.

### 5. Client API module

```typescript
// client/lib/interactions-api.ts

export interface Interaction {
  id: string;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
  schemaVersion: number;
  contactId: string;
  occurredAt: string;
  type: 'meeting' | 'call' | 'email' | 'message' | 'other';
  summary: string | null;
  location: string | null;
}

export interface InteractionInput {
  contactId: string;
  occurredAt: string;
  type: Interaction['type'];
  summary?: string | null;
  location?: string | null;
}

export interface InteractionListResponse { interactions: Interaction[]; }
export interface InteractionResponse     { interaction: Interaction; }

export function fetchInteractions(contactId: string): Promise<InteractionListResponse>
export function createInteraction(input: InteractionInput): Promise<InteractionResponse>
export function deleteInteraction(id: string): Promise<void>  // raw fetch — 204 No Content
```

`deleteInteraction` uses raw `fetch` (same pattern as `deleteContact`) because `apiFetch` calls `.json()` on success, which throws on 204 No Content.

### 6. Client: interaction timeline

```tsx
// client/components/interaction-timeline.tsx
```

Rendered inside `ContactDetail`, below the `contact-fields` dl and above `contact-actions`.

Props: `{ contactId: string }`.

**Behavior:**
- Fetches `GET /api/interactions?contactId={contactId}` on mount.
- "Log interaction" button at the top of the section → opens `LogInteractionModal`.
- Loading state: "Loading interactions…"
- Empty state: "No interactions yet. Log your first one."
- Each row shows: type label, formatted `occurredAt` date (local timezone), and the first 80 characters of `summary` (truncated with "…" if longer). Clicking the row body toggles the full summary inline.
- **Delete control:** Each row has a dedicated delete button (icon button or explicitly labeled "Delete") that is visually distinct from the row body click target. The delete control must NOT be triggered by clicking the row body — the two interactions must be separate hit targets. This prevents accidental deletion when expanding a summary. (See acceptance criteria.)
- Delete button calls `deleteInteraction(id)` → removes the interaction from the list in place, no page reload. No confirmation modal in Sprint 05 (add to backlog).
- Errors during fetch or delete propagate to ErrorBoundary.

### 7. Client: log interaction modal

```tsx
// client/components/log-interaction-modal.tsx
```

Props: `{ contactId: string, isOpen: boolean, onClose: () => void, onSaved: (interaction: Interaction) => void }`.

**Fields:**
- `occurredAt` — `<input type="datetime-local">`. Default value: current local datetime, computed when the modal opens (not when the page loads).
- `type` — `<select>` with all five enum values. Default: `meeting`.
- `summary` — `<textarea>`, optional.
- `location` — `<input type="text">`, optional.

**Focus trap and ESC:** same pattern as `ConfirmModal` — Cancel button gets initial focus, Tab cycles between interactive elements, ESC calls `onClose`, focus restored to opener on close.

**Submit:**
- Convert `occurredAt` from the datetime-local input value to UTC ISO: `new Date(inputValue).toISOString()`.
- POST `{ contactId, occurredAt, type, summary: trimmed || null, location: trimmed || null }`.
- On success: call `onSaved(interaction)`, close modal.
- ApiError 400: show inline error message inside the modal.
- Other errors: propagate to ErrorBoundary.

## Scope (explicitly out)

- Edit interaction (`PUT /api/interactions/:id`) — add to backlog.
- `GET /api/interactions/:id` — add to backlog.
- Per-interaction delete confirmation modal — add to backlog.
- Inbox capture format, inbox parser, inbox processing route — Sprint 06.
- "Process inbox" trigger button — Sprint 06.
- Review queue UI — Sprint 06.
- Apple Shortcut documentation — Sprint 06.
- Full-text search across interactions — defer to polish sprint.
- Interaction metadata/tags — backlog (YAGNI).
- Obsidian markdown projection of interactions — Sprint 09.
- Atomic group-write for cascade delete — backlog.

## Directory layout (target additions)

```
server/
├── schemas/
│   └── interaction.ts              (Interaction Zod schema + INTERACTION_SCHEMA_VERSION)
├── routes/
│   ├── interactions.ts             (GET list, POST create, DELETE soft-delete)
│   ├── interactions.test.ts
│   ├── contacts.ts                 (modified: cascade delete + interactionsStore dep)
│   └── contacts.test.ts            (new cascade tests)
└── services/
    └── storage.ts                  (add interactionsStore, update StorageContext)

client/
├── pages/
│   └── contact-detail.tsx          (modified: add InteractionTimeline)
├── components/
│   ├── interaction-timeline.tsx
│   └── log-interaction-modal.tsx
└── lib/
    └── interactions-api.ts
```

## Interfaces

### Interaction schema
```typescript
export const INTERACTION_SCHEMA_VERSION = 1;

export const InteractionSchema = BaseRecordSchema.extend({
  contactId:  z.string().uuid(),
  occurredAt: z.string().datetime(),
  type:       z.enum(['meeting', 'call', 'email', 'message', 'other']),
  summary:    z.string().max(10000).nullable(),
  location:   z.string().max(200).nullable(),
});

export type Interaction = z.infer<typeof InteractionSchema>;
```

### Interaction create schema (server-side)
```typescript
const InteractionCreateSchema = z.object({
  contactId:  z.string().uuid(),
  occurredAt: z.string().datetime(),
  type:       z.enum(['meeting', 'call', 'email', 'message', 'other']),
  summary:    z.string().max(10000).nullable().optional(),
  location:   z.string().max(200).nullable().optional(),
}).strict();
```

### API responses
```typescript
// GET /api/interactions?contactId=:id
interface InteractionListResponse {
  interactions: Interaction[];
}

// POST /api/interactions
interface InteractionResponse {
  interaction: Interaction;
}

// DELETE /api/interactions/:id — 204 No Content
```

## Backlog additions from this sprint

Add to `backlog.md`:
- [ ] Edit interaction (PUT /api/interactions/:id + client form)
- [ ] GET /api/interactions/:id
- [ ] Per-interaction delete confirmation modal
- [ ] Atomic group-write for contact cascade delete (currently accepts partial failure)
- [ ] Interaction metadata/tags field (revisit if extension needs emerge)
- [ ] Inbox capture format, parser, processing route — Sprint 06
- [ ] Apple Shortcut documentation for inbox capture — Sprint 06
- [ ] Review queue UI (list ambiguous inbox entries, resolve by selecting correct contact) — Sprint 06
- [ ] Decide final home for inbox processing trigger (status view, settings, contact list header) when inbox feature ships in Sprint 06

## Acceptance criteria

See `acceptance.md`.

## Session prompts

- *Session 1:* "Read CLAUDE.md, then specs/sprint-05-interactions/spec.md. Implement: Interaction schema and storage wiring (Sections 1–2), interaction API endpoints with tests (Section 3), contact cascade soft-delete with tests (Section 4). Update ContactsRouterDeps and server/index.ts. Do not implement client code yet."
- *Session 2:* "Continue Sprint 05. Implement: client interactions-api module (Section 5), InteractionTimeline component (Section 6), LogInteractionModal component (Section 7), full test suite. Run end-of-sprint checklist."
