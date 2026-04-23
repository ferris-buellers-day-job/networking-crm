# Networking CRM — Claude Code Context

## What this project is
A personal networking CRM for David, a product manager, to track professional relationships over time. Single-user, privacy-first, local-first. Not a product for others. Built iteratively using Claude Code across short, focused sprints.

Location: `~/ClaudeProjects/networking-crm/`
Data: `~/Library/Mobile Documents/com~apple~CloudDocs/NetworkingCRM/`
Backup: `~/NetworkingCRM-backup/` (git repo, outside iCloud)

## How to work in this repo
1. **Always start by reading `docs/vision.md` if this is a fresh session.** It anchors the "why."
2. **Identify the current sprint.** Look in `specs/` for the folder with the highest number that does *not* live under `specs/archive/`. Read only that sprint's `spec.md` and `acceptance.md` before writing code.
3. **Do not read every file in the repo.** This project is designed so each sprint is self-contained. Reading archived sprints or unrelated ADRs burns tokens without benefit.
4. **Check `docs/decisions/` only when the current spec references a specific ADR, or when making a non-obvious architectural choice.**
5. **Prefer small, verifiable steps.** If a sprint has multiple scope items, implement one at a time and confirm with David before proceeding. Don't batch unrelated work.

## Tech stack
- **Runtime:** Node.js 20+ with TypeScript (strict mode). Managed via `fnm` with `.nvmrc` pinning the version.
- **Frontend:** React with Vite. No Next.js, no SSR.
- **Backend:** Express serving both the API and the built React bundle, bound explicitly to `127.0.0.1`.
- **Storage (source of truth):** JSON files in iCloud Drive. See ADR 005.
- **Storage (derived cache):** SQLite via `better-sqlite3`. Disposable. Rebuilds from JSON on demand. See ADR 005.
- **Validation:** Zod schemas on every read and write. See ADR 006.
- **File watching:** `chokidar` to detect external edits to JSON files.
- **Phone number handling:** `libphonenumber-js`, E.164 canonical format. See ADR 009.
- **iPhone sync strategy:** iPhone writes only to `inbox.txt` via Apple Shortcut. Read access on iPhone via Obsidian reading a markdown projection of the JSON data. See ADR 004.
- **LLM integration:** Anthropic API (Claude Sonnet), manual-trigger only. API key in `.env`. See ADR 003.
- **Backup:** Daily git commit of the data directory to a separate local repo. See ADR 008.
- **Remote:** Code lives in a private GitHub repo. Data does not.

## Hard rules (do not violate)

### Security and privacy
- **Never commit** `.env`, API keys, the SQLite cache, iCloud data files, the inbox, or any log files. `.gitignore` must cover these.
- **Never attempt LinkedIn scraping or unofficial API use.** Manual entry only. See ADR 002.
- **Treat all contact data as sensitive.** No telemetry, no analytics, no third-party logging. Error logs stay on the local machine.

### Architecture
- **JSON files are the source of truth.** The SQLite cache is always disposable and always rebuildable. Never store data only in the cache. See ADR 005.
- **iPhone never writes to the database or to JSON files.** Only to `inbox.txt`. The Mac app is the sole writer.
- **Never run the Mac app on two machines simultaneously.** Single-writer invariant.
- **Bind the Express server to `127.0.0.1` only, never `0.0.0.0`.** This app is localhost-only.

### Data integrity
- **All JSON writes are atomic.** Write to `.tmp`, fsync, rename. Never write directly to the target path. See ADR 007.
- **Every read validates the JSON against a Zod schema.** On validation failure, quarantine the file (move to `.quarantine/`), log the incident, and surface to the UI. Never display unvalidated data. See ADR 006.
- **Every record has a stable UUID.** Filenames include human-readable slugs for convenience, but the `id` field in the JSON is authoritative and immutable. See ADR 006.
- **References are by UUID, never by name or slug.** See ADR 006.
- **All dates are UTC ISO 8601 with `Z` suffix** (`2026-04-22T14:32:00.000Z`). Display in local timezone; store in UTC.
- **Deletes are soft.** Set `deletedAt`; never remove records. See ADR 006.
- **Fields never change type.** Add new fields; don't repurpose existing ones. See ADR 006.
- **Every record has `id`, `createdAt`, `updatedAt`, `deletedAt` (nullable), and `schemaVersion` fields.** See ADR 006.
- **Phone numbers stored in E.164.** Parsed via `libphonenumber-js` with the contact's default country for ambiguous inputs. See ADR 009.

### Error handling
- **Fail loud, never silent.** Every `catch` block must either recover meaningfully and log, surface to the user, or rethrow. No empty catches. See ADR 007.
- **No optimistic UI for writes.** The UI reflects disk state. Saves show a spinner; "saved" only appears after the bytes are on disk. See ADR 007.
- **Every user-facing error includes a copyable debug block.** Designed to be pasted into a Claude Code session verbatim for troubleshooting. See ADR 010.
- **Retries are bounded and targeted.** Used for transient failures (iCloud sync lag, API calls). Never for validation failures or bugs.

### LLM usage
- **Never auto-call the Anthropic API.** All LLM calls are triggered by an explicit button press. See ADR 003.
- **Never generate draft messages to contacts.** The LLM produces summaries and suggested questions, not ghostwritten communications. See ADR 003.
- **Every LLM-generated claim must cite an interaction ID.** Uncited claims are rendered as "unsupported" in the UI. See ADR 003.

## Coding conventions
- TypeScript strict mode on. No `any` without a comment explaining why.
- Filenames: kebab-case (`contact-list.tsx`, not `ContactList.tsx`).
- Commit messages follow conventional commits (`feat:`, `fix:`, `docs:`, `refactor:`, `chore:`).
- No CSS frameworks until the polish sprint. Plain CSS or CSS modules.
- Log format: structured JSON per line (`{"ts":"...","level":"info","op":"...","msg":"..."}`) for easy grep and tailability.
- Git workflow: push to origin after every commit. Do not batch pushes.

## Documentation maintenance protocol
**At the end of every working session, before David closes the session, run the following checklist out loud in chat so he can confirm:**

1. Did we make any architectural decision in this session that is not already in an ADR? If yes, draft a new ADR in `docs/decisions/` following `docs/decisions/_template.md` and ask David to review before committing.
2. Did we change the tech stack, data model, or any "hard rule" above? If yes, propose an edit to `CLAUDE.md` and ask David to review.
3. Did we complete any acceptance criteria from the current sprint? If yes, update `specs/sprint-XX/acceptance.md` by checking off the items.
4. Did we discover a new issue, idea, or risk not covered by the current sprint? If yes, append it to `backlog.md` under the appropriate heading.
5. If the sprint is fully complete: move the sprint folder to `specs/archive/`, add a dated entry to `CHANGELOG.md`, push to GitHub, and ask David which sprint to start next.

**Do not skip this checklist. If David forgets to ask, remind him.**

## Where things live
- `docs/vision.md` — why this exists, what success looks like. Read on fresh sessions.
- `docs/architecture.md` — stack, data model, directory layout. Read when touching foundational code.
- `docs/conventions.md` — coding patterns beyond what's in this file.
- `docs/data-schema.md` — authoritative contract for every JSON record shape. Update whenever schemas change.
- `docs/decisions/` — ADRs. Read only when the current task references one.
- `specs/sprint-XX-name/` — active sprint. Read before coding.
- `specs/archive/` — completed sprints. Do not read unless David explicitly asks.
- `backlog.md` — unsorted ideas. Read only if David asks about future features.
- `CHANGELOG.md` — shipped work, dated.

## Current sprint
**Sprint 02 — Foundation Storage.** See `specs/sprint-02-foundation-storage/spec.md`.

## Sprint sequence (for context; don't pre-read)
1. Skeleton — project scaffolding, nothing persistent.
2. Foundation storage — FileStore, Zod, SQLite cache, file watcher, logging, git backup.
3. Error handling — fail-loud framework, debug-formatted errors, System Status view.
4. Contacts — first real entity, i18n phone handling.
5. Interactions + inbox processing.
6. Tiers, reminders, action items.
7. Claude API integration.
8. ICS + email reminder batching.
9. Obsidian markdown projection.
10. LinkedIn CSV import.
11. Polish — keyboard shortcuts, search, styling.
