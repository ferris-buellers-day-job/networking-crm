# Sprint 05 — Acceptance Criteria

## Interaction schema

- [ ] `InteractionSchema` requires `contactId`, `occurredAt`, and `type`.
- [ ] `InteractionSchema` accepts nullable `summary` and `location`.
- [ ] `InteractionSchema` rejects invalid `type` values not in the enum.
- [ ] `INTERACTION_SCHEMA_VERSION = 1` is exported from `server/schemas/interaction.ts`.
- [ ] FileStore for interactions is constructed with `expectedSchemaVersion: INTERACTION_SCHEMA_VERSION`.

## Interaction API — GET /api/interactions

- [ ] `GET /api/interactions?contactId=:id` returns `{ interactions: [] }` for a contact with no interactions.
- [ ] Returns only non-deleted interactions (`deletedAt === null`) for the specified `contactId`.
- [ ] Returns interactions sorted by `occurredAt` descending (newest first).
- [ ] Returns 400 ValidationError if `contactId` query param is absent.
- [ ] Skips quarantined interaction files (logs warning, continues — existing FileStore behavior).

## Interaction API — POST /api/interactions

- [ ] Creates an interaction and returns 201 with `{ interaction }`.
- [ ] Created interaction has `deletedAt: null` and `schemaVersion: 1`.
- [ ] Returns 400 ValidationError with message "Contact not found or deleted" if `contactId` references a non-existent contact.
- [ ] Returns 400 ValidationError if `contactId` references a soft-deleted contact.
- [ ] Returns 400 for extra fields in the request body (strict mode).
- [ ] Returns 400 for an invalid `type` value.
- [ ] Returns 400 if `occurredAt` is not a valid ISO 8601 datetime string.
- [ ] `summary` and `location` default to null when omitted.

## Interaction API — DELETE /api/interactions/:id

- [ ] Soft-deletes an interaction and returns 204.
- [ ] Returns 404 for a non-existent id.
- [ ] Returns 404 for an already-soft-deleted interaction.
- [ ] Returns 404 for a quarantined interaction file.

## Contact cascade soft-delete

- [ ] Soft-deleting a contact sets `deletedAt` on all of that contact's non-deleted interactions.
- [ ] The `deletedAt` timestamp on the contact and all cascaded interactions is identical.
- [ ] Soft-deleting a contact with no interactions returns 204 with no errors.
- [ ] Already-deleted interactions under the contact are not re-written during cascade.
- [ ] After cascade delete, `GET /api/interactions?contactId=:id` returns an empty array.
- [ ] If an interaction write fails during cascade (mock `interactionsStore.save` to throw a `StorageError`), the DELETE request returns 500 and the contact's `deletedAt` remains null (verified by re-fetching the contact).
- [ ] Calling `DELETE /api/contacts/:id` a second time (after the first succeeds) returns 404 — cascade is idempotent because the contact is already deleted.

## Client: interaction timeline

- [ ] `ContactDetail` renders `InteractionTimeline` below the contact fields and above the action buttons.
- [ ] Timeline shows a loading state while fetching.
- [ ] Timeline shows "No interactions yet. Log your first one." when the list is empty.
- [ ] Interactions are listed newest-first (`occurredAt` descending).
- [ ] Each row shows: type label, formatted `occurredAt` date in local timezone, and the first 80 characters of `summary` (truncated with "…" if longer).
- [ ] Clicking the row body expands the full summary inline; clicking again collapses it.
- [ ] Each row has a dedicated delete control (icon button or labeled button) that is visually distinct from the row body and does NOT expand/collapse the summary when clicked.
- [ ] The delete control removes the interaction from the list without a page reload.
- [ ] "Log interaction" button at the top of the timeline section opens `LogInteractionModal`.
- [ ] Errors during fetch propagate to `ErrorBoundary`.

## Client: log interaction modal

- [ ] Modal opens with `occurredAt` defaulting to the current local datetime.
- [ ] Modal opens with `type` defaulting to `meeting`.
- [ ] Cancel button closes the modal without submitting.
- [ ] ESC closes the modal without submitting.
- [ ] Cancel button receives initial focus when modal opens.
- [ ] Submit calls `POST /api/interactions` and the new interaction appears in the timeline without a page reload.
- [ ] ApiError 400 from the server shows an inline error message inside the modal.
- [ ] Non-400 errors from the server propagate to `ErrorBoundary`.
