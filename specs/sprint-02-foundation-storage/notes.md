# Sprint 02 — Working Notes

Append decisions made during the sprint here. At sprint close, promote durable decisions to ADRs if needed.

---

## Decision history

### Phase 1: Open questions identified (2026-05-07)

During spec drafting, Claude Code identified six open questions requiring product decisions:

| # | Question | Options considered |
|---|----------|-------------------|
| a | FileStore API signature | Sync vs async (Promise-based) |
| b | Cache sync strategy | Eager on every write vs lazy with file watcher debouncing |
| c | Backup service scheduling | Startup only, daily timer, or both |
| d | Log rotation | Rolling by date, by size, or neither |
| e | Zod version alignment | Which version, any conflicts? |
| f | Testing harness | Vitest, Jest, or Node test runner |

### Phase 2: Claude Code's initial defaults (2026-05-07)

Claude Code proposed defaults with reasoning:

1. **FileStore API: Async** — keeps door open for future async operations; matches Express conventions.
2. **Cache sync: Eager + lazy hybrid** — eager for internal writes (immediate consistency), lazy via file watcher for external edits.
3. **Backup: Both startup and daily** — per ADR 008's recommendation.
4. **Logs: Rotate by date** — `app-YYYY-MM-DD.log`, simple and matches preview.md.
5. **Zod: 3.23+** — latest stable, no conflicts with existing deps.
6. **Testing: Vitest** — integrates with existing Vite setup.

David approved all defaults for Phase 2 without changes.

### Phase 3: David's product decisions on review (2026-05-07)

David reviewed the spec and made additional product decisions:

#### Confirmed (no change from defaults)
- FileStore API is async.
- Cache sync: eager on internal writes, lazy via watcher for external edits.
- Backup runs on startup and daily.
- Logs rotate by date.
- Zod 3.23+, Vitest for testing.
- Tests at the foundation level only, using temp directories.
- Data directory structure as specified.
- File watcher debounce at 300ms.

#### New decisions

**Decision 2a — Quarantine visibility:**
> When a file is quarantined, the app must print a loud, visible warning to the Terminal where `npm run dev` is running, in addition to writing to the log file. Use a clear marker like `⚠️  QUARANTINED:` followed by the file path and reason. This is independent of the log level — quarantine warnings always display.

*Rationale:* Quarantine is a serious event that indicates data corruption or schema drift. It should be impossible to miss during development.

**Decision 3b — File watcher self-write suppression:**
> The FileWatcher must distinguish between changes made by the app itself versus external changes. Implementation: when AtomicWriter completes a write, it records the absolute file path and current timestamp in an in-memory Map. The FileWatcher consults this Map on every event; if the path was written by the app within the last 500ms, the event is suppressed. Entries expire after 500ms. The shared "recent writes" Map lives in `server/lib/recent-writes.ts` and is passed to both AtomicWriter and FileWatcher.

*Rationale:* Without this, the eager cache update from internal writes would be followed by a redundant file watcher event, causing unnecessary re-reads and potential race conditions.

**Decision 4c — Log retention:**
> Logs auto-delete after 30 days. On logger initialization (and on each date rollover), scan the log directory for files matching `app-YYYY-MM-DD.log` whose date is more than 30 days old, and delete them. Make the retention period configurable via `LOG_RETENTION_DAYS` env var with default 30.

*Rationale:* Prevents unbounded disk growth. 30 days is enough for debugging recent issues while keeping the data directory tidy.

**Decision 5a — Schema version mismatch handling:**
> If a record's `schemaVersion` is higher than the code expects (i.e., written by a future version of the app), the FileStore must quarantine the file with a clear log message indicating "schema version too high." If lower, a migration path will be added in Sprint 04 when the first real entity ships; for Sprint 02, document this as a future concern in the spec and add a `// TODO(sprint-04)` comment in the relevant code. Each entity type will define its own expected schema version constant.

*Rationale:* A too-high schema version indicates the data was written by a newer app version — loading it with older code could cause data loss. Quarantine is the safe choice. Migration for older versions is deferred until we have real entities to migrate.

**Decision 7a — Startup failure handling:**
> Define startup as a sequence with mixed failure semantics:
> - Storage layer init failure → fatal, app exits with clear error.
> - Integrity check finding fatal issues (missing `.schema-version`, schema mismatch) → fatal, app exits.
> - Integrity check finding non-fatal issues (quarantined files, conflict files) → log warnings, continue startup.
> - Backup failure → log warning, continue startup.
> - File watcher init failure → log warning, continue startup with reduced functionality.

*Rationale:* The app should not run if its data foundation is broken (no directories, no schema version). But it should be able to run in degraded mode if optional services fail — better to serve requests with warnings than to refuse to start entirely.

---

*Add notes below as the sprint progresses.*
