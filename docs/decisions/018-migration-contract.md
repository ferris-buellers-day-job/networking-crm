# ADR 018: Schema migration contract for FileStore (upgrade-on-read, eager persist)

**Status:** Accepted
**Date:** 2026-09-04

## Context

ADR 006 §3 anticipated "a migration function that maps older versions forward on read." ADR 012 specified that migration logic lives co-located with the entity's Zod schema in `server/schemas/`. ADR 016 deferred implementation because `FileStore.readAndValidate` quarantined any record whose `schemaVersion` differed from `expectedSchemaVersion` — making it unsafe to bump any entity's schema version. This ADR fulfils the ADR 006 §3 contract and unblocks all future schema bumps.

## Decision

### Migration registration

`FileStoreOptions` gains an optional `migrations` field:

```typescript
type MigrationFn = (record: Record<string, unknown>) => Record<string, unknown>;

interface FileStoreOptions<T> {
  expectedSchemaVersion: number;
  migrations?: Record<number, MigrationFn>;  // key = fromVersion
  // ...
}
```

Migration functions are **synchronous**. They receive the record at its on-disk shape (typed as `Record<string, unknown>`, not the current Zod type) and return it in the next shape. Entity schema files export their migration maps alongside their Zod schemas (per ADR 012); the `FileStore` constructor in `server/services/storage.ts` receives them at wiring time.

### Chain application on read

When `readAndValidate` encounters `schemaVersion < expectedSchemaVersion`, it applies the registered migration chain in ascending order:

```
for v from onDiskVersion to expectedSchemaVersion - 1:
  if migrations[v] absent → quarantine (Failure 2)
  run migrations[v](current); if throws → quarantine (Failure 1)
  FileStore auto-bumps: current.schemaVersion = v + 1
```

**FileStore auto-bumps `schemaVersion` after each step.** Migration functions must not set `schemaVersion` in their output — if they do, the value is overwritten by the auto-bump.

### Timestamp preservation

Before the chain loop, `FileStore` captures the original `createdAt` and `updatedAt` from the raw parsed record. After the chain completes and before Zod validation, it force-restores them:

```typescript
current = { ...current, createdAt: originalCreatedAt, updatedAt: originalUpdatedAt };
```

This is a FileStore guarantee, not a convention — if a migration function modifies these fields, the modification is silently overwritten. **Restoration must occur before Zod validation** (the validate-what-you-write invariant: what gets validated is exactly what gets written to disk).

A migration is not a user edit. Stamping `updatedAt` with the migration timestamp would corrupt real edit history.

### Post-migration Zod validation

After the chain and timestamp restoration, the migrated record is validated against the current Zod schema (`this.schema.safeParse`). If validation fails, the file is quarantined (Failure 3). This catches migrations that return without throwing but produce a record that violates the current schema.

### Eager write-back (persist-back policy)

On a successful migration chain and post-migration validation, the migrated record is written back to disk **immediately**, using `atomicWriteJson` directly on the original file path (ADR 007 atomic path). The SQLite cache is then updated.

Write-back uses `atomicWriteJson` directly (not `save()`) because:
1. `save()` re-derives the filename via `filenamePattern` (directory scan); write-back must target the exact file just read.
2. `save()` double-validates — the migrated record was validated immediately before write-back.
3. Direct `atomicWriteJson` allows precise classification of disk failures as `StorageError`.

`this.recentWrites` is passed to `atomicWriteJson` so the file watcher does not treat the write-back as an external edit.

### Four failure classifications

| # | Mode | Trigger | Behavior | Reason string format |
|---|------|---------|----------|---------------------|
| 1 | Migration fn threw | `migrateFn(current)` throws | Quarantine | `"Migration vN→vN+1 threw: <message>"` |
| 2 | No fn registered | `migrations[v]` absent | Quarantine | `"no migration function registered for vN→vN+1"` |
| 3 | Post-migration validation failed | `schema.safeParse` fails after chain | Quarantine | `"migration vN→vM produced a record that fails current-schema validation: <zod error>"` |
| 4 | Write-back disk failure | `atomicWriteJson` throws | `StorageError`, **no quarantine** | `"Migration write-back failed: <message>"` |

Failures 1–3 are "bad data" — the file is suspect and isolated for investigation. Failure 4 is "bad disk" — the original file is intact at its path and the operation is retryable on the next `get()`.

Failure 3's reason string deliberately does not contain the word "threw" — distinguishing it from Failure 1 in logs.

### No rollback migrations

There are no downgrade migrations. `schemaVersion > expectedSchemaVersion` continues to quarantine (unchanged). Downgrading past a schema bump is unsupported; running old code against records written by a newer version is a deployment error requiring manual resolution.

### Cache consistency on write-back failure

The migration path in `readAndValidate` is only reachable on a **cache miss** — `get()` returns the cached record immediately on a cache hit, never calling `readAndValidate`. Therefore, when migration runs via `get()` without `forceReload`, the cache is empty for this id throughout the migration. A write-back failure (Failure 4) throws before `cacheDb.upsert`, leaving the cache empty. The next `get()` will cache-miss, re-read the still-intact original from disk, and re-run the migration chain.

### Testing contract

Migration tests use synthetic test-only schemas defined inline in test files, not production entity schemas. Old-version records are written to temp directories using `fs.promises.writeFile` directly (bypassing `store.save()`, which validates against the current schema). See `server/lib/file-store-migration.test.ts`.

## Consequences

- Schema version bumps are now safe for any entity. The first bump after this ADR ships will be the practical proof.
- The `migrations` option is optional and defaults to `{}` — all existing `FileStore` instances behave identically on non-migration reads.
- `readAndValidate` can now throw `StorageError` in addition to `FileStoreQuarantineError` — callers that previously only guarded against quarantine errors must be aware of this new error surface on any `get()` or `getAll()` call (in practice, the error handler middleware already handles `StorageError` through the `AppError` hierarchy).
- Boot-time behaviour: the first `getAll()` after a schema bump eagerly migrates and rewrites every stale record in the directory, converging the entire entity set to the current version in one pass.

## References

- ADR 006 §3 — migration-function-on-read contract (this ADR fulfils it)
- ADR 007 — atomic write path (`atomicWriteJson`)
- ADR 012 — migration logic co-located with entity schema
- ADR 016 — why schema version bumps were blocked until now
