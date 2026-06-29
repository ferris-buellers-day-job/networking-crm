# Sprint 05 — Acceptance Criteria

## Interaction schema

- [x] `InteractionSchema` requires `contactId`, `occurredAt`, and `type`.
- [x] `InteractionSchema` accepts nullable `summary` and `location`.
- [x] `InteractionSchema` rejects invalid `type` values not in the enum.
- [x] `INTERACTION_SCHEMA_VERSION = 1` is exported from `server/schemas/interaction.ts`.
- [x] FileStore for interactions is constructed with `expectedSchemaVersion: INTERACTION_SCHEMA_VERSION`.

## Interaction API — GET /api/interactions

- [x] `GET /api/interactions?contactId=:id` returns `{ interactions: [] }` for a contact with no interactions.
- [x] Returns only non-deleted interactions (`deletedAt === null`) for the specified `contactId`.
- [x] Returns interactions sorted by `occurredAt` descending (newest first).
- [x] Returns 400 ValidationError if `contactId` query param is absent.
- [x] Skips quarantined interaction files (logs warning, continues — existing FileStore behavior).

## Interaction API — POST /api/interactions

- [x] Creates an interaction and returns 201 with `{ interaction }`.
- [x] Created interaction has `deletedAt: null` and `schemaVersion: 1`.
- [x] Returns 400 ValidationError with message "Contact not found or deleted" if `contactId` references a non-existent contact.
- [x] Returns 400 ValidationError if `contactId` references a soft-deleted contact.
- [x] Returns 400 for extra fields in the request body (strict mode).
- [x] Returns 400 for an invalid `type` value.
- [x] Returns 400 if `occurredAt` is not a valid ISO 8601 datetime string.
- [x] `summary` and `location` default to null when omitted.

## Interaction API — DELETE /api/interactions/:id

- [x] Soft-deletes an interaction and returns 204.
- [x] Returns 404 for a non-existent id.
- [x] Returns 404 for an already-soft-deleted interaction.
- [x] Returns 404 for a quarantined interaction file.

## Contact cascade soft-delete

- [x] Soft-deleting a contact sets `deletedAt` on all of that contact's non-deleted interactions.
- [x] The `deletedAt` timestamp on the contact and all cascaded interactions is identical.
- [x] Soft-deleting a contact with no interactions returns 204 with no errors.
- [x] Already-deleted interactions under the contact are not re-written during cascade.
- [x] After cascade delete, `GET /api/interactions?contactId=:id` returns an empty array.
- [x] If an interaction write fails during cascade (mock `interactionsStore.save` to throw a `StorageError`), the DELETE request returns 500 and the contact's `deletedAt` remains null (verified by re-fetching the contact).
- [x] Calling `DELETE /api/contacts/:id` a second time (after the first succeeds) returns 404 — cascade is idempotent because the contact is already deleted.

## Client: interaction timeline

- [x] `ContactDetail` renders `InteractionTimeline` below the contact fields and above the action buttons.
- [x] Timeline shows a loading state while fetching.
- [x] Timeline shows "No interactions yet. Log your first one." when the list is empty.
- [x] Interactions are listed newest-first (`occurredAt` descending).
- [x] Each row shows: type label, formatted `occurredAt` date in local timezone, and the first 80 characters of `summary` (truncated with "…" if longer).
- [x] Clicking the row body expands the full summary inline; clicking again collapses it.
- [x] Each row has a dedicated delete control (icon button or labeled button) that is visually distinct from the row body and does NOT expand/collapse the summary when clicked.
- [x] The delete control removes the interaction from the list without a page reload.
- [x] "Log interaction" button at the top of the timeline section opens `LogInteractionModal`.
- [x] Errors during fetch propagate to `ErrorBoundary`.

## Client: log interaction modal

- [x] Modal opens with `occurredAt` defaulting to the current local datetime.
- [x] Modal opens with `type` defaulting to `meeting`.
- [x] Cancel button closes the modal without submitting.
- [x] ESC closes the modal without submitting.
- [x] Cancel button receives initial focus when modal opens.
- [x] Submit calls `POST /api/interactions` and the new interaction appears in the timeline without a page reload.
- [x] ApiError 400 from the server shows an inline error message inside the modal.
- [x] Non-400 errors from the server propagate to `ErrorBoundary`.
