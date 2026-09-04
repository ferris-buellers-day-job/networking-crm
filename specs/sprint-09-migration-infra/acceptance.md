# Sprint 09 — Acceptance Criteria

## Registration mechanism

- [ ] `FileStoreOptions<T>` gains an optional `migrations` field typed as
  `Record<number, MigrationFn>` where `MigrationFn = (record: Record<string, unknown>) => Record<string, unknown>`.
- [ ] `MigrationFn` is exported from `server/lib/file-store.ts` so entity schema
  files can import and type their migration maps.
- [ ] `FileStore` constructor stores the migrations map and makes it available to
  `readAndValidate`.
- [ ] A `FileStore` instance constructed with no `migrations` option (or `migrations: {}`)
  behaves identically to pre-Sprint-09 behaviour on all non-migration code paths —
  all pre-existing `file-store.test.ts` tests pass without modification.

---

## Happy path — single-step migration

- [ ] A raw JSON file written directly to the temp directory at `schemaVersion: 1`
  (bypassing `store.save()`) is read via `store.get(id)` against a `FileStore`
  constructed with `expectedSchemaVersion: 2` and a registered `1→2` migration;
  the returned record has `schemaVersion: 2` and the migrated field present at its
  migrated value.
- [ ] `FileStore` auto-bumps `schemaVersion` after each migration step; migration
  functions do **not** set `schemaVersion` in their output — if they do, the value
  is overwritten. *(Test: migration function returns `{ ...record, schemaVersion: 99 }`;
  assert returned record has `schemaVersion: 2`, not 99.)*
- [ ] **Eager write-back:** after `store.get(id)` returns, reading the on-disk file
  directly (bypassing the cache) shows `schemaVersion: 2` — migration is persisted
  immediately, not deferred to the next explicit save.
- [ ] The SQLite cache is updated with the migrated record; a subsequent
  `store.get(id)` (cache-warm, no `forceReload`) returns the migrated record without
  re-reading disk.

---

## Happy path — two-step chain

- [ ] A raw v1 file with migrations registered for `1→2` and `2→3` is read against
  `expectedSchemaVersion: 3`; the returned record has `schemaVersion: 3` with fields
  from both migration steps correctly applied (v1→v2 field present; v2→v3 field
  present).
- [ ] The chain applies steps sequentially (v1→v2 output feeds v2→v3 input); the
  intermediate `schemaVersion: 2` state is **never** written to disk — only the final
  `schemaVersion: 3` is written in the eager write-back.
- [ ] On-disk file after `get()` has `schemaVersion: 3`.

---

## Version-match skip (no migration needed)

- [ ] A record already at `expectedSchemaVersion` is read via `store.get()`; no
  migration function runs; no write-back occurs; the record is returned correctly.
  *(Regression guard — every existing production entity read takes this path.)*

---

## Mid-chain failure — disk and cache atomicity

*A multi-step migration must leave disk and cache fully consistent on any chain
failure — no intermediate version may be persisted anywhere. This is the multi-step
analog of Failure-4's "original intact" assertion, extended to cover the cache.*

**Test setup requirement — cold read mandatory:** the v1 file must be written using
`fs.promises.writeFile` directly to the entity temp directory, NOT via `store.save()`.
`store.save()` would populate the SQLite cache with the v1 record; a subsequent
`store.get(id)` would return from cache and never execute the migration chain, making
all three assertions vacuous. The raw-write pattern ensures the cache is empty for
this id before the trigger call.

- [ ] A raw v1 file (written via `fs.promises.writeFile`, not `store.save()`) is read
  against a `FileStore` with `expectedSchemaVersion: 3` and migrations
  `{ 1: fn1to2, 2: fn2to3 }`, where `fn1to2` succeeds and `fn2to3` throws.
  `store.get(id)` throws `FileStoreQuarantineError` (Failure 1 — the v2→v3 step
  threw). This is the trigger call; the chain executes because the cache is cold.
- [ ] **Disk state:** the quarantined file contains the original `schemaVersion: 1`
  content — the completed v1→v2 intermediate result was never written to disk. Assert
  by reading the quarantined file directly from `.quarantine/` and confirming its
  `schemaVersion` field is `1`.
- [ ] **Cache state — direct lookup, not store.get():** after the quarantine failure,
  query the cache directly via `cacheDb.get(tableName, id)` and assert it returns
  `null`. This specifically proves no partial v2 record was written to cache at any
  point in the chain. *(Do NOT use `store.get()` for this assertion — `store.get()`
  routes through both cache and disk, returning `null` when both are empty, but that
  combined result does not isolate the cache claim. A direct cache lookup is
  unambiguous.)*
- [ ] **No corrupt state anywhere:** the two assertions above together prove that after
  a mid-chain failure, no intermediate version (v2) exists on disk or in cache. The
  system has no partial state from the failed migration.

*Note on "retryability": unlike Failure 4 (write-back failed, file intact at original
path), a mid-chain quarantine is not retryable from the original path — the file has
been moved to `.quarantine/`. Recovery requires manual quarantine inspection. This is
intentional and correct: a migration function that throws is suspect data or a code
bug, both of which require human review.*

## Timestamp preservation

### Happy-path timestamp test

- [ ] The on-disk file's `updatedAt` after a successful migration equals the
  `updatedAt` value that was in the original v1 file — the migration write-back does
  not stamp a new `updatedAt`.
- [ ] The on-disk file's `createdAt` after a successful migration equals the
  `createdAt` value that was in the original v1 file.

### Ordering-sensitive timestamp test

*This criterion proves that timestamp restoration occurs **before** Zod validation,
not after. `BaseRecordSchema` types `updatedAt` as `z.string().datetime({ offset: true })`,
so a non-datetime value fails Zod validation. If restoration were moved after validation,
a migration that corrupted `updatedAt` to a non-datetime value would trigger a Failure-3
quarantine instead of succeeding. With restoration before validation, FileStore overwrites
the corrupt value with the original before Zod runs, and the record migrates cleanly.
The happy-path test (spread-based migration) does NOT distinguish the orderings; this test does.*

- [ ] A migration function that accidentally overwrites `updatedAt` with an invalid
  datetime string (e.g. `'not-a-date'`) — simulating a buggy migration that forgets
  to spread base fields correctly — causes `store.get()` to **succeed** and return
  a migrated record; no quarantine fires.
- [ ] The on-disk file after this migration has the **original** `updatedAt` value
  (the valid datetime from the v1 file), not the corrupt value produced by the
  migration function.
- [ ] *(Implicit proof:)* If timestamp restoration were moved to after Zod validation,
  this test would fail — the record would quarantine (Failure 3) instead of migrating.
  Passing this test in the correct implementation is evidence that restoration runs first.

---

## Four failure classifications

Each of the following four modes must have a **dedicated test**. The four failure types
are distinct and must not be conflated — exception type, reason string, and post-failure
file location each serve as distinguishing observables.

### Failure 1 — migration function threw → quarantine

- [ ] A migration function that throws `new Error('bad data')` causes `store.get()`
  to throw a `FileStoreQuarantineError`.
- [ ] The quarantine reason string contains `"Migration v1→v2 threw"` (or equivalent
  pattern identifying the step) and includes the original error message.
- [ ] The original file has been moved to `.quarantine/` after the throw — it is no
  longer at its original path.

### Failure 2 — no migration registered for a required step → quarantine

- [ ] A v1 file read against `expectedSchemaVersion: 2` with **no** entry at key `1`
  in the migrations map causes `store.get()` to throw `FileStoreQuarantineError`.
- [ ] The reason string contains `"no migration function registered"` and identifies
  the missing step (e.g. `"v1→v2"`).
- [ ] The file has been moved to `.quarantine/`.
- [ ] A chain gap test: migrations `{ 1: fn }` registered but `expectedSchemaVersion: 3`
  (missing `2→3`) — quarantines with reason identifying the missing `2→3` step, not the
  registered `1→2`.

### Failure 3 — post-migration Zod validation failed → quarantine

*This catches a buggy migration that returns without throwing but produces a record
that violates the current schema — e.g. drops a required field.*

- [ ] A deliberately-buggy migration function — one that returns only `{ id: record.id,
  schemaVersion: record.schemaVersion }` (dropping all other required fields) — causes
  `store.get()` to throw `FileStoreQuarantineError`.
- [ ] The quarantine reason string contains `"current-schema validation"` (or equivalent
  wording identifying post-migration schema failure) and includes the Zod error.
- [ ] The reason string does **not** contain the word `"threw"` — this failure is
  semantically distinct from Failure 1 and must be identifiable in logs without
  ambiguity.
- [ ] The file has been moved to `.quarantine/`.

### Failure 4 — write-back to disk failed → StorageError, no quarantine

*This is "bad disk, not bad data." The migration and validation succeeded; the original
file is still intact and valid. The operation is retryable.*

**Note on atomicity testing:** Testing that the rename step specifically fails while
the .tmp file is intact — and that atomicWriteJson cleans up the .tmp on failure —
requires mocking at the `node:fs/promises.rename` level, which would affect all rename
operations in the test including setup writes. That test would be probing
`atomicWriteJson`'s own error-handling contract, not migration code. It is NOT included
here; if needed, it belongs in `atomic-writer.test.ts`. What this sprint tests is the
migration code's response to a write-back failure, using a mock of `atomicWriteJson`
at the module level.

**Failure 4a — propagation test:**

- [ ] `atomicWriteJson` is mocked via `vi.mock('./atomic-writer.js', ...)` to throw
  `new Error('disk full')` for write-back calls. (Setup writes use `fs.promises.writeFile`
  directly and are unaffected by the mock.)
- [ ] `store.get(id)` throws a `StorageError` — **not** a `FileStoreQuarantineError`.
- [ ] The original v1 file remains readable at its original path after the failure —
  it has **not** been quarantined. *(Assert by reading the file with `fs.promises.readFile`
  and confirming its `schemaVersion` is still 1.)*

**Failure 4b — retryability test:**

- [ ] After a Failure 4a write-back error, the mock is cleared (or the mock resets to
  the real implementation). A subsequent `store.get(id, { forceReload: true })` succeeds:
  the migration re-runs from the still-intact v1 file, the write-back succeeds this time,
  and the migrated v2 record is returned.
- [ ] This demonstrates that Failure 4 leaves the system in a retryable state with no
  permanent data loss.

---

## Version-too-high — no regression

- [ ] A raw JSON file with `schemaVersion` **higher** than `expectedSchemaVersion` causes
  `store.get()` to throw `FileStoreQuarantineError` with a reason containing `"too high"`,
  identical to pre-Sprint-09 behaviour. The migration infrastructure does not alter this
  code path.

---

## `getAll()` — mixed-version, with on-disk write-back assertion

- [ ] A temp directory contains three files: (a) a v1 record with a valid registered
  migration, (b) a v1 record whose migration function throws (Failure 1), and (c) a
  record already at the current version.
- [ ] `store.getAll()` returns exactly two records — (a) migrated and (c) unchanged —
  and does not throw.
- [ ] Record (b) is quarantined; `getAll()` logs a warning and continues per the existing
  per-file quarantine behaviour.
- [ ] **Eager write-back through `getAll()`:** after `getAll()` returns, reading record
  (a)'s file directly from disk (bypassing the cache) shows `schemaVersion: 2` — the
  eager write-back fires through the `getAll()` path, not only through single `get()`
  calls. *(This proves the boot-time batch-migration scenario: the first `getAll()` after
  a schema bump migrates the entire directory.)*

---

## Scope boundary

- [ ] `CONTACT_SCHEMA_VERSION`, `INTERACTION_SCHEMA_VERSION`, `INBOX_ENTRY_SCHEMA_VERSION`,
  and `REMINDER_SCHEMA_VERSION` all remain `1` after this sprint.
- [ ] No `migrations` map is passed to any production `FileStore` instance in
  `server/services/storage.ts`.
- [ ] No production entity schema file (`server/schemas/*.ts`) is modified.
- [ ] All pre-existing `file-store.test.ts` tests pass without modification.
- [ ] All entity-route tests (contacts, interactions, inbox, reminders) pass without
  modification — their v1-version records read via the version-match-skip path with
  no migration logic engaged.

---

## ADR 018

- [ ] `docs/decisions/018-migration-contract.md` exists and covers: migration
  registration (`MigrationFn` type; `migrations` option; co-location per ADR 012);
  chain application order and auto-version-bump; timestamp preservation policy (capture
  before chain, restore before validation); eager write-back via `atomicWriteJson`
  (ADR 007); four failure classifications with distinct behaviors and reason-string
  formats; no-rollback policy; testing contract (synthetic schemas; raw JSON writes);
  references to ADR 006 §3, ADR 007, ADR 012, ADR 016.
