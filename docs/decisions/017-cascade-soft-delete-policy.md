# ADR 017: General cascade soft-delete policy for contact-anchored entities

**Status:** Accepted
**Date:** 2026-08-16

## Context

ADR 013 established the write-order invariant for the first contact-anchored child entity (Interaction): when a contact is soft-deleted, its active interactions are soft-deleted first, the contact is soft-deleted last. The invariant guarantees that if any child write fails, the contact remains active and the full cascade is retryable — no orphaned child records, no partial-delete state that blocks retry.

Reminders are the second contact-anchored entity. Rather than document the same reasoning a second time in a separate entity-specific ADR, this ADR generalizes the pattern.

## Decision

Any entity with a `contactId` foreign key is a **contact-anchored child entity**. When a contact is soft-deleted, all of its non-deleted child records are soft-deleted before the contact's own `deletedAt` is written. The write sequence for `DELETE /api/contacts/:id` is:

1. Soft-delete active interactions (`deletedAt === null`) for the contact.
2. Soft-delete pending reminders (`status === 'pending'` and `deletedAt === null`) for the contact.
3. Write the contact's `deletedAt`.

**Done reminders are excluded from cascade.** A reminder with `status: 'done'` and `deletedAt: null` is completed history — the user acted on it. Cascading it would destroy that record. It must survive contact deletion with `deletedAt: null`.

**Write-order invariant:** If any write in the sequence fails, the contact's `deletedAt` is not written. The contact remains active. The full cascade sequence can be retried with no risk of duplicate deletes (soft-delete is idempotent — re-saving a record with `deletedAt` already set is a no-op in practice, and the cascade filter re-filters on each attempt).

**Future child entities** (e.g. action items) must be added to the cascade sequence above before shipping, or contact deletes will leave orphaned records. The sequence must be documented in this ADR as each entity is added.

## Cascade sequence (current)

| Step | Entity | Filter |
|---|---|---|
| 1 | Interaction | `contactId === id && deletedAt === null` |
| 2 | Reminder | `contactId === id && status === 'pending' && deletedAt === null` |
| 3 | Contact | (the contact itself) |

## Relation to ADR 013

ADR 013 is the historical record of the interactions-specific decision and the origin of the write-order invariant. ADR 013 is not edited. This ADR inherits and generalizes its rationale.

## Consequences

- Contact deletes are slightly slower as more child entity types are added — acceptable at personal-CRM scale.
- Every new contact-anchored entity must be registered in this ADR's cascade sequence. Omitting it is a silent data bug (orphaned records after contact delete).
- The pattern is testable: each step in the cascade sequence should have a write-order invariant test confirming that a failure at that step leaves the contact active and all subsequent steps unrun.
