# ADR 013: Cascade Soft-Delete Write Order for Contact Deletion

**Status:** Accepted
**Date:** 2026-06-28

## Context

When a contact is soft-deleted via `DELETE /api/contacts/:id`, all of that contact's non-deleted interactions must also be soft-deleted (cascade). This requires multiple sequential writes to disk: one write per active interaction, then one write for the contact itself. Because the storage layer (`FileStore`) writes each record atomically in isolation but provides no multi-record transaction primitive, any write in the sequence can fail independently. The system must define a write order and specify what constitutes an acceptable partial-failure state.

The relevant code is `server/routes/contacts.ts`, the `DELETE /api/contacts/:id` handler, implemented in Sprint 05 (spec Section 4).

## Decision

Write interactions first, then the contact. If any interaction write fails, the handler rethrows the error and returns 500; the contact's `deletedAt` is not set. Interactions already written in that request remain deleted.

## Consequences

**Easier:**
- Partial failure leaves the contact active and visible. A client can safely retry `DELETE /api/contacts/:id` and the handler will re-run the cascade. Interactions already marked deleted are filtered out by the `deletedAt === null` guard in step 3 of the handler, so they are not re-written — the operation is idempotent.
- The UI invariant "a deleted contact has no visible interactions" is preserved on the happy path. A contact only becomes invisible after all its interactions are already gone.

**Harder / risks introduced:**
- If the cascade fails partway, the system enters a temporarily inconsistent state: some interactions are deleted but the contact remains active. Already-deleted interactions drop out of `GET /api/interactions?contactId=:id` while the contact stays active. This is visible to the user only if they inspect the contact detail page between a failed and a retried delete — acceptable at personal scale with a single writer.
- There is no alert or UI indication that a partial cascade occurred. The 500 response is the only signal; the user must retry manually.

**Backlogged:** Atomic group-write support in `FileStore` (write a set of records transactionally, rolling back on partial failure) would eliminate the inconsistency window. Tracked in `backlog.md`.

## Alternatives considered

**Contact first, then interactions.** If the contact write succeeds but a subsequent interaction write fails, the contact is marked deleted while some of its interactions remain active — orphaned interactions that are invisible in the UI (since the contact detail page is unreachable) but present on disk. A retry of `DELETE /api/contacts/:id` would return 404 (contact already deleted), making the orphaned interactions unrecoverable without manual intervention. This is strictly worse than the chosen order and was rejected.

**Abort on first interaction write failure, roll back already-written interactions.** Would require re-reading and re-writing each already-deleted interaction to restore it, adding complexity and more write surface. At personal scale with rare deletions, the added code is not worth the benefit over a simple retry.
