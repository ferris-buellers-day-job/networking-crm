# Sprint 09 — Schema Migration Infrastructure

## Goal

Ship the upgrade-on-read migration infrastructure that makes schema version bumps safe. After this sprint:

- `FileStore` can apply a registered chain of migration functions when it reads a record whose on-disk `schemaVersion` is lower than `expectedSchemaVersion`.
- Migrated records are written back to disk immediately after migration (eager persist), using the same atomic write path (ADR 007) as all other writes, with original timestamps preserved.
- Four failure modes are classified and handled distinctly — bad-data failures quarantine the file; a bad-disk failure propagates a retryable `StorageError`.
- A synthetic test entity (test-only, never exported to production) proves all code paths including every failure mode.
- ADR 018 documents the migration contract.

No production entity schema version is bumped in this sprint. The deliverable is pure infrastructure.

## Background and motivation

ADR 016 explains why schema version bumps have been blocked since Sprint 04. `FileStore.readAndValidate` (lines 298–306 of `server/lib/file-store.ts`) quarantines any record whose `schemaVersion` does not exactly match `expectedSchemaVersion` — there is no migration hook. `CONTACT_SCHEMA_VERSION`, `INTERACTION_SCHEMA_VERSION`, `INBOX_ENTRY_SCHEMA_VERSION`, and `REMINDER_SCHEMA_VERSION` are all 1. Bumping any of them without this infrastructure would quarantine every existing record of that entity type on the next read.

ADR 006 §3 anticipated "a migration function that maps older versions forward on read." ADR 012 specified that migration logic lives alongside the entity's Zod schema in `server/schemas/`. ADR 016 deferred the implementation. This sprint fulfils the contract described in ADR 006 §3.

## Scope boundary — explicit

**Not in scope:**
- Bumping any production entity's `schemaVersion` (all remain at 1 after this sprint)
- Registering migration functions on any production `FileStore` instance
- Any change to entity schemas (`server/schemas/contact.ts`, `interaction.ts`, `inbox-entry.ts`, `reminder.ts`)
- Any client-side changes
- Any change to routes, storage wiring, or UI

**The only production file modified is `server/lib/file-store.ts`.** The only new files are `docs/decisions/018-migration-contract.md` and the migration test file (see §7). Existing entity schemas and their `FileStore` wiring in `server/services/storage.ts` are untouched.

---

## §1 — Migration registration

### `MigrationFn` type

```typescript
type MigrationFn = (record: Record<string, unknown>) => Record<string, unknown>;
```

Migration functions are **synchronous**. They receive the record at its current (pre-migration) shape typed as `Record<string, unknown>` — not the current Zod type — and return the record in the next shape. They do **not** set `schemaVersion`; `FileStore` auto-bumps it after each step. If a migration function includes `schemaVersion` in its output, that value is **overwritten** by the auto-bump.

`MigrationFn` should be exported from `file-store.ts` so entity schema files can import and use it in their migration maps.

### `FileStoreOptions` update

```typescript
export interface FileStoreOptions<T> {
  filenamePattern?: (record: T) => string;
  expectedSchemaVersion: number;
  migrations?: Record<number, MigrationFn>;  // key = fromVersion, e.g. { 1: v1ToV2, 2: v2ToV3 }
}
```

The `migrations` option is optional. A `FileStore` instance with no `migrations` entry (or `migrations: {}`) behaves identically to pre-Sprint-09 behaviour for all non-migration code paths — existing tests pass without modification.

### Where migration functions live

Per ADR 012: migration logic lives co-located with the entity's Zod schema in `server/schemas/`. An entity schema file exports both the schema and its migrations map:

```typescript
// server/schemas/contact.ts — ILLUSTRATIVE ONLY; Contact stays at v1 this sprint
export const CONTACT_SCHEMA_VERSION = 2;   // hypothetical future bump

export const ContactSchema = BaseRecordSchema.extend({ ... });

export const contactMigrations: Record<number, MigrationFn> = {
  1: (record) => ({ ...record, newNullableField: null }),
};
```

The `FileStore` constructor in `server/services/storage.ts` receives the migrations map alongside the schema at wiring time. **No production entity is bumped this sprint** — this pattern is established for future use.

---

## §2 — Updated `readAndValidate` flow

The following is the complete state machine for `readAndValidate`. **Step ordering is load-bearing; do not reorder.**

```
READ FILE FROM DISK
│
├─ [ENOENT — file disappeared between listing and reading]
│    → return null                                                       (unchanged)
│
├─ [JSON parse error]
│    → quarantine("Invalid JSON"), throw FileStoreQuarantineError        (unchanged)
│
├─ schemaVersion > expectedSchemaVersion
│    → quarantine("schema version too high..."),
│      throw FileStoreQuarantineError                                    (unchanged)
│
├─ schemaVersion === expectedSchemaVersion
│    → skip migration, jump to ZOD VALIDATE below                        (unchanged)
│
└─ schemaVersion < expectedSchemaVersion  ──────────────── MIGRATION PATH (new)
     │
     Capture originalTimestamps from raw parsed object:
       originalCreatedAt = parsed.createdAt
       originalUpdatedAt = parsed.updatedAt
     │
     let current: Record<string, unknown> = parsed;
     │
     CHAIN LOOP  for (v = onDiskVersion; v < expectedSchemaVersion; v++):
     │
     ├─ Look up this.migrations[v]
     │    └─ [absent] → quarantine("no migration function registered for vN→vN+1"),
     │                  throw FileStoreQuarantineError
     │
     ├─ Try: current = this.migrations[v](current)
     │    └─ [throws err] → quarantine("Migration vN→vN+1 threw: <err.message>"),
     │                      throw FileStoreQuarantineError
     │
     └─ FileStore auto-bumps: current = { ...current, schemaVersion: v + 1 }
          (migration function output schemaVersion is ignored and overwritten)
     │
     END LOOP
     │
     TIMESTAMP RESTORE (must come before Zod validation — see §5)
     current = {
       ...current,
       createdAt: originalCreatedAt,
       updatedAt: originalUpdatedAt,
     };
     │
     ZOD VALIDATE current against this.schema (the current-version Zod schema)
     │
     ├─ [fails] → quarantine(
     │              "migration vN→vM produced a record that fails current-schema
     │               validation: <zod error message>"
     │            ),
     │            throw FileStoreQuarantineError
     │
     └─ [passes] → record = parseResult.data  (typed as T)
          │
          EAGER WRITE-BACK (must use atomicWriteJson directly — see §3)
          try {
            await atomicWriteJson(filePath, record, this.recentWrites);
          } catch (err) {
            throw new StorageError(
              `Migration write-back failed: ${err.message}`,
              { op: 'fileStore.migrate', context: { filePath } }
            );
            // DO NOT quarantine — the file on disk is still the valid old version
          }
          │
          this.cacheDb.upsert(this.tableName, record as T & Record<string, unknown>);
          │
          return record;
```

---

## §3 — Four failure classifications

The four failure modes are distinct. "Bad data" (failures in the migration logic or its output) quarantine the file — the data is suspect and must be isolated for investigation. "Bad disk" (failure writing the migrated result back) is a transient infrastructure error — the original file is intact and the operation is retryable.

| # | Mode | Trigger | Behavior | Exception type | File on disk after |
|---|------|---------|----------|---------------|-------------------|
| 1 | Migration function threw | `this.migrations[v](current)` throws | Quarantine; log with step and error message | `FileStoreQuarantineError` | Moved to `.quarantine/` |
| 2 | No migration registered | `this.migrations[v]` is absent | Quarantine; log missing step | `FileStoreQuarantineError` | Moved to `.quarantine/` |
| 3 | Post-migration validation failed | `this.schema.safeParse(current)` fails after chain | Quarantine; log distinct reason including Zod error | `FileStoreQuarantineError` | Moved to `.quarantine/` |
| 4 | Write-back disk failure | `atomicWriteJson` throws | Throw `StorageError`; do NOT quarantine | `StorageError` | Intact at original path; still schemaVersion N |

**Reason string requirements (for log and `FileStoreQuarantineError.reason`):**

- Failure 1: `"Migration v${v}→v${v+1} threw: ${err.message}"`
- Failure 2: `"no migration function registered for v${v}→v${v+1}"`
- Failure 3: `"migration v${onDisk}→v${expected} produced a record that fails current-schema validation: ${zodError}"`
- Failure 4: reason goes into `StorageError`, not quarantine — format: `"Migration write-back failed: ${err.message}"`

These reason strings are observable in tests and must match (substring match is sufficient).

---

## §4 — Eager write-back

The migration write-back uses `atomicWriteJson` directly (not `this.save()`), targeting the exact `filePath` that was just read:

```typescript
await atomicWriteJson(filePath, record, this.recentWrites);
```

**Why not `save()`:**
1. `save()` calls `findFileById()` — a directory scan — and re-generates the filename via `filenamePattern`. Write-back must target the exact path just read, not a path reconstructed from a directory scan.
2. `save()` re-validates against `this.schema`. We validated immediately before the write-back call; double-validation is redundant and introduces a window where the record could differ from what was validated.
3. `save()` does not distinguish migration-write-back failures from validation errors in its error surface. Direct `atomicWriteJson` lets us classify and throw `StorageError` precisely.

**Failure handling:** If `atomicWriteJson` throws, catch it, throw `StorageError`. Do not quarantine — the file on disk is still the valid old-version record (the atomic write either renamed successfully or cleaned up its .tmp file on failure). The `StorageError` propagates to the caller, who can retry.

**Cache update:** On successful write-back, `cacheDb.upsert` is called with the migrated record. On write-back failure (StorageError path), the cache is NOT updated — the cache will cache-miss on the next read, forcing a re-read from disk, which will re-run the migration chain. This is the retryable behaviour.

**`getAll()` path:** `readAndValidate` is called per file inside `getAll()`. Eager write-back fires through this path identically. After a successful `getAll()` on a directory with stale-version records, every migrated record is on disk at the current version. This is the boot-time batch-migration behaviour: the first `getAll()` after a version bump migrates the entire directory.

---

## §5 — Timestamp preservation and ordering invariant

### The force-restore

After the migration chain runs and before Zod validation, `FileStore` forces the original `createdAt` and `updatedAt` back into `current`, regardless of what migration functions returned for those fields:

```typescript
// originalCreatedAt and originalUpdatedAt captured from raw parsed object
// BEFORE the chain loop began
current = {
  ...current,
  createdAt: originalCreatedAt,
  updatedAt: originalUpdatedAt,
};
```

A migration is not a user edit. Stamping `updatedAt` with the migration timestamp would corrupt real edit history — "Alice's record was last modified 2026-09-04" would become meaningless if a schema migration overwrote it. `FileStore` enforces timestamp preservation as a guarantee, independent of what migration functions do.

### Why restoration must come before Zod validation

**BaseRecordSchema** types `createdAt` and `updatedAt` as `z.string().datetime({ offset: true })`. This means any value that is not a valid ISO 8601 datetime string fails Zod validation.

If a migration function corrupts `updatedAt` — for instance, a buggy function that forgets to spread base fields and sets `updatedAt` to `undefined` or an arbitrary non-datetime string — the outcome differs by ordering:

- **Restoration BEFORE validation (specified ordering):** The corrupt value is overwritten by the known-good original before validation runs. Validation sees a valid datetime and passes. The record migrates successfully. The written-back file has the original, correct `updatedAt`.

- **Restoration AFTER validation:** Validation runs on the corrupt value. `z.string().datetime()` rejects it. Failure 3 quarantine fires — the record is quarantined even though the only problem was a migration bug touching timestamps, and even though the data itself was recoverable. The user's file is in quarantine because of a migration author oversight.

The validate-what-you-write invariant additionally requires this order: the record written to disk must be exactly the record that was validated. If restoration runs after validation, what is written differs from what was validated (timestamps change). Placing restoration before validation ensures the validated record and the written record are identical.

### What the happy-path timestamp test proves (and what it doesn't)

The happy-path test — a migration using `{ ...record, newField: null }` — does **not** distinguish restoration-before from restoration-after, because the migration preserves all base fields including timestamps. The assertion that `on-disk updatedAt === original updatedAt` passes regardless of ordering in the happy path.

The criterion that **does** distinguish the ordering: a migration that accidentally overwrites `updatedAt` with an invalid value. Under the specified ordering (restoration first), this test passes — FileStore corrects it. Under restoration-after-validation, this test fails — the record quarantines. **This criterion is included in acceptance.md** as the ordering-sensitive timestamp test. That test bites on incorrect implementation.

---

## §6 — ADR 018

`docs/decisions/018-migration-contract.md` covers:

- **Migration registration:** `MigrationFn` type; `FileStoreOptions.migrations` option; co-location with schema per ADR 012.
- **Chain application:** ascending order from `onDiskVersion` to `expectedSchemaVersion - 1`; `FileStore` auto-bumps `schemaVersion` after each step (migration function output version is ignored).
- **Timestamp preservation:** `FileStore` captures original `createdAt`/`updatedAt` before the chain loop and force-restores them after the chain, before validation and write-back. Migration functions must not modify base timestamps; if they do, the modification is silently overwritten.
- **Application timing:** on read, inside `readAndValidate`, before Zod validation of the migrated record. Migration results are not deferred.
- **Persist-back policy:** eager — migrated records are written back to disk atomically (ADR 007) before `get()` or `getAll()` returns.
- **Four failure classifications** with distinct behaviors and reason-string formats (§3).
- **No rollback migrations:** downgrading past a schema bump is unsupported. `schemaVersion > expectedSchemaVersion` continues to quarantine.
- **Testing contract:** synthetic test-only schemas in test files; raw JSON writes bypassing `save()`.
- **References:** ADR 006 §3 (fulfils migration-function-on-read contract), ADR 007 (atomic write), ADR 012 (migration logic co-located with schema), ADR 016 (why bumps were blocked until now).

---

## §7 — Testing strategy

### Synthetic schemas (test-only)

The test file defines its own minimal schemas for v1, v2, and v3. These are **not** exported and **not** based on any production entity. Using synthetic schemas keeps the tests independent of production schema changes and keeps production schemas clean.

```typescript
// Defined inline in the test file — NOT in server/schemas/
const V1Schema = BaseRecordSchema.extend({ label: z.string() });
const V2Schema = BaseRecordSchema.extend({ label: z.string(), tag: z.string().nullable() });
const V3Schema = BaseRecordSchema.extend({ label: z.string(), tag: z.string().nullable(), rank: z.number() });

const v1ToV2: MigrationFn = (r) => ({ ...r, tag: null });
const v2ToV3: MigrationFn = (r) => ({ ...r, rank: 0 });
```

### Raw JSON write pattern

Raw v1 records are written directly to the temp entity directory using `fs.promises.writeFile`, bypassing `store.save()` (which would validate against the current schema and fail on an old-shape record). This pattern was established in Sprint 07:

```typescript
const FIXED_CREATED = '2026-01-01T10:00:00.000Z';
const FIXED_UPDATED = '2026-01-01T12:00:00.000Z';

await writeFile(
  path.join(tempDir, 'test-entities', `${id}.json`),
  JSON.stringify({
    id,
    schemaVersion: 1,
    createdAt: FIXED_CREATED,
    updatedAt: FIXED_UPDATED,
    deletedAt: null,
    label: 'hello',
  })
);
```

### Write-back failure simulation

Use `vi.mock('./atomic-writer.js', ...)` to make `atomicWriteJson` throw. The initial raw-write setup uses `fs.promises.writeFile` (not `atomicWriteJson`), so mocking `atomicWriteJson` affects only the migration write-back call and does not break the test setup. See Failure 4 criterion in acceptance.md for the exact mocking and assertion requirements.

### Required test cases (summary — full criteria in acceptance.md)

1. Happy path: single-step migration (v1→v2)
2. Happy path: two-step chain (v1→v2→v3)
3. Version-match skip: no migration runs, no write-back
4. Timestamp preservation — happy path: on-disk `updatedAt` unchanged
5. Timestamp preservation — ordering-sensitive: migration that corrupts `updatedAt` still succeeds
6. Failure 1: migration function threw → quarantine
7. Failure 2: no migration registered → quarantine
8. Failure 3: post-migration validation failed → quarantine (distinct reason string)
9. Failure 4a: write-back threw → `StorageError`, original file intact, NOT quarantined
10. Failure 4b: retryable — after Failure 4, `store.get(id, { forceReload: true })` succeeds on retry
11. Version-too-high: no regression
12. `getAll()` mixed-version: migrated record is on disk at v2 after call; quarantined record skipped; no throw

---

## §8 — Directory layout (changes only)

```
server/
└── lib/
    ├── file-store.ts                        (modified — migration chain, failure handling,
    │                                         eager write-back, timestamp preservation)
    └── file-store-migration.test.ts         (new — all migration tests using synthetic schemas)

docs/
└── decisions/
    └── 018-migration-contract.md            (new)
```

No other files are modified. All entity schema files, `server/services/storage.ts`, `server/index.ts`, and all route files are untouched.

---

## §9 — Interfaces

```typescript
// Additions to server/lib/file-store.ts

export type MigrationFn = (record: Record<string, unknown>) => Record<string, unknown>;

export interface FileStoreOptions<T> {
  /** Custom filename pattern. Default: `<id>.json` */
  filenamePattern?: (record: T) => string;
  /** Expected schema version. Records below this version are migrated; records above quarantine. */
  expectedSchemaVersion: number;
  /** Migration functions keyed by fromVersion. Absence means no migrations registered. */
  migrations?: Record<number, MigrationFn>;
}
```

No other type changes.

---

## Backlog additions

Add to `backlog.md` under "Sprint 09 Additions":

- [ ] Action items — reconsider as optional `dueAt` on Reminder rather than a separate entity. With migration infrastructure, `REMINDER_SCHEMA_VERSION` can safely bump to 2 with `dueAt` made nullable (`.nullable().default(null)` for new records; v1→v2 migration is a no-op since all existing reminders already have `dueAt`). This collapses "action item" and "reminder" into one entity with an optional deadline.
- [ ] First real-entity migration — apply the infrastructure to any future non-additive schema change on a production entity (Contact, Interaction, etc.).
- [ ] `atomic-writer.test.ts` lacks a rename-failure / .tmp-cleanup test. The existing "does not leave temp files on error" test fails at `open(tempPath, 'w')` (missing parent directory) — the .tmp file is never created, so cleanup is trivial. The untested path is: `open`/`writeFile`/`datasync`/`close` all succeed, then `rename` fails, leaving a populated .tmp file that must be cleaned up by `unlink`. The atomic guarantee relied upon by migration write-back is not directly proven. Add a test that mocks `rename` to throw and asserts both that the error propagates AND that no .tmp file remains on disk.

---

## Session prompts

- *Session 1:* "Read CLAUDE.md, then specs/sprint-09-migration-infra/spec.md. Implement §1–§6: add `MigrationFn` type and `migrations` to `FileStoreOptions`, update `readAndValidate` with the full state machine (chain loop with auto-bump, timestamp capture and restore, post-migration Zod validation, eager write-back via `atomicWriteJson`, `StorageError` on write-back failure). Write `docs/decisions/018-migration-contract.md`. Modify only `server/lib/file-store.ts`. Do not write tests."

- *Session 2:* "Read CLAUDE.md, then specs/sprint-09-migration-infra/spec.md §7 and `specs/sprint-09-migration-infra/acceptance.md`. Session 1 (FileStore changes + ADR 018) is already committed. Write `server/lib/file-store-migration.test.ts` using synthetic schemas (not production entities). Cover all acceptance criteria: happy-path single-step and chain, timestamp preservation including the ordering-sensitive case, version-match skip, all four failure modes each with a dedicated test, Failure-4 retryability, version-too-high no-regression, `getAll()` mixed-version with on-disk write-back assertion, and scope boundary (all production entities still at v1, all existing tests pass)."
