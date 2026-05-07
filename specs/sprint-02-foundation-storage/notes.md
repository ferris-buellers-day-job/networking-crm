# Sprint 02 — Working Notes

Append decisions made during the sprint here. At sprint close, promote durable decisions to ADRs if needed.

## Pre-sprint decisions (from spec drafting)

1. **FileStore API is async** — even though `better-sqlite3` is sync, the FileStore wrapper uses Promises because the JSON write path involves disk I/O and future operations may need async.

2. **Cache sync strategy: eager + lazy hybrid** — internal writes update cache immediately after atomic JSON write; external edits detected by file watcher (debounced 300ms).

3. **Backup runs on startup and daily** — covers both fresh launches and long-running sessions.

4. **Logs rotate by date** — one file per day, `app-YYYY-MM-DD.log`.

5. **Zod 3.23+** — latest stable, no conflicts with existing deps.

6. **Vitest for testing** — integrates with existing Vite setup.

---

*Add notes below as the sprint progresses.*
