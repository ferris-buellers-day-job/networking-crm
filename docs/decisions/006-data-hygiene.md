# ADR 006: Data hygiene rules for long-term integrity and exportability

**Status:** Accepted
**Date:** 2026-04-22

## Context
Data written with poor hygiene becomes hard to query, impossible to migrate cleanly, and error-prone at scale. These costs are paid later, often years later, and are much cheaper to prevent than to remediate. This ADR codifies the rules that apply to every record the app writes.

## Decision
The following rules apply to all records, enforced by Zod schemas on every read and write:

1. **Every record has a stable UUID.** Field: `id: string` (UUID v4). Generated at creation; never changes. Filenames may include human-readable slugs for convenience, but `id` is authoritative. References between records use `id`, never slugs or names.

2. **Every record has timestamps.** Fields: `createdAt: string`, `updatedAt: string`, `deletedAt: string | null`. Format is UTC ISO 8601 with `Z` suffix (`2026-04-22T14:32:00.000Z`). `updatedAt` changes on every write; `deletedAt` is null unless the record is soft-deleted.

3. **Every record has a schema version.** Field: `schemaVersion: number`. Bumped whenever the schema changes. A migration function maps older versions forward on read.

4. **Deletes are soft.** Records are marked with `deletedAt` and hidden from the default UI. Files remain on disk. A separate "purge" operation (manual, explicit) can remove old soft-deleted records later.

5. **Enumerated values are typed, not freeform.** Channels, tiers, tag types, and similar fields use TypeScript literal unions backed by Zod `z.enum(...)`. Values are lowercase, snake_case where multi-word (`in_person`, not `In Person` or `In-Person`).

6. **Fields never change type.** If `tier` starts as a string, it remains a string. To introduce a new representation, add a new field and migrate gradually.

7. **Strings have length limits.** Representative defaults: name 200 chars, company 200, notes 50,000, tag name 50. Enforced in Zod. Prevents runaway content and catches accidental paste bombs.

8. **Normalization on write.** Trim whitespace, collapse internal multi-space runs to single spaces, lowercase emails and URL hostnames, strip trailing slashes from URLs. Applied in a single normalization function before Zod validation.

9. **Phone numbers stored in E.164.** Parsed via `libphonenumber-js` using the contact's default country (ISO 3166-1 alpha-2 code). See ADR 009.

10. **Referential integrity.** Every write that references another record must verify the target exists and is not soft-deleted. Cache rebuild verifies all references and reports violations to the integrity report.

11. **Authoritative schema document.** `docs/data-schema.md` describes every field of every record type. This is the migration contract — kept current as schemas evolve.

## Consequences
**Easier:** migration to any future system is a straightforward mapping exercise. Querying is predictable. Deduplication is easier (UUIDs + normalized fields). Audit trails are preserved.

**Harder:** more boilerplate per record type (Zod schemas, version numbers, normalization). A few minutes of discipline per new entity.

**New risks:** if a schema version is introduced but the migration function is missing, reads fail loud. This is the intended behavior — surfaces the issue immediately rather than silently reading wrong data.

## Alternatives considered
- **No hygiene rules, fix later:** tempting for speed, disastrous at scale. Rejected.
- **Hard deletes instead of soft:** simpler, but accidental deletions become unrecoverable. Rejected.
- **Slugs as primary keys:** simpler code today, but renames break every reference. Rejected.
- **Freeform enums:** duplicates ("Email", "email", "e-mail") would accumulate silently. Rejected.
