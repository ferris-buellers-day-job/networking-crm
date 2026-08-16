# ADR 016: Additive nullable fields via Zod defaults at current schema version; version bumps deferred

**Status:** Accepted
**Date:** 2026-08-15

## Context

`FileStore.readAndValidate` in `server/lib/file-store.ts` enforces strict schema version matching:

```typescript
if (schemaVersion < this.expectedSchemaVersion) {
  const reason = `Schema migration not yet implemented (found v${schemaVersion}, expected v${this.expectedSchemaVersion})`;
  await this.quarantine(filePath, reason);
  throw new FileStoreQuarantineError(...);
}
```

Any record whose on-disk `schemaVersion` is lower than `expectedSchemaVersion` is quarantined immediately — moved to `.quarantine/`, removed from cache, and a `FileStoreQuarantineError` is thrown. The same applies in the other direction: a `schemaVersion` higher than expected is also quarantined. There is no migration function hook, no lenient pass-through.

ADR 006 §3 describes migration functions that map older versions forward on read, but the infrastructure to run them does not exist. No sprint has ever bumped a schema version: `CONTACT_SCHEMA_VERSION`, `INTERACTION_SCHEMA_VERSION`, and `INBOX_ENTRY_SCHEMA_VERSION` are all 1. Bumping any version number without implementing the corresponding migration function would quarantine every existing record of that entity the next time the app reads them.

## Decision

Purely additive nullable fields — fields whose absence from existing records is semantically equivalent to `null` — are added to a Zod schema using `.nullable().default(null)` at the **current `schemaVersion`**. The `schemaVersion` constant is not incremented.

This is safe because Zod's `.default(null)` coerces `undefined` (the value Zod sees for an absent key when parsing a JSON object) to `null` before type validation runs. An existing JSON file that has no `tier` key parses as `{ ..., tier: null }` without error. The on-disk `schemaVersion` still matches `expectedSchemaVersion`, so no quarantine fires.

The new field is written on the next save, so files converge to the full current schema over time without a forced migration pass.

## Applicability condition

This pattern is valid **only** when all of the following hold:

1. The field is new — it did not previously exist in any on-disk record.
2. The field's absence is semantically equivalent to `null` for every existing record.
3. `null` is an acceptable initial value for all existing records.

It **cannot** be used for:
- Fields with non-null defaults (e.g. a new required flag defaulting to `true`)
- Type changes on existing fields
- Field renames or removals
- Structural changes (new nested objects, arrays with invariants)

Those cases require proper migration infrastructure.

## Consequence

Until migration infrastructure is built, schema version bumps are blocked for all entities. Every schema addition must fit this "additive nullable" pattern or wait. This constraint must be surfaced explicitly before any sprint that needs a non-nullable new field, a non-null default, or any non-additive change.

This ADR is the **project-wide precedent** for adding fields to existing schemas. Reference it whenever a nullable field is added to an existing entity.

## Alternatives considered

- **Bump version and quarantine-then-migrate manually:** requires a one-time migration script run before deploying; error-prone at personal scale with real data on disk. Rejected until migration infrastructure makes this safe.
- **Bump version and rebuild from scratch:** destructive; rejected outright.
- **Keep a separate `schemaVersion`-less "extension" file per record:** over-engineered; rejected.
