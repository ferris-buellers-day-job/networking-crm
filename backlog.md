# Backlog

Unsorted ideas and future work. Items here are not committed to any sprint.

## Capture & Input

- [ ] Apple Shortcut authoring guidance (document how to create the iPhone capture shortcut)
- [ ] iCloud folder structure documentation (what subfolders, naming conventions)
- [ ] LinkedIn CSV import (one-time bulk import of existing connections)
- [ ] Business card photo OCR (stretch goal)

## Output & Sync

- [ ] ICS export (calendar events for follow-up reminders)
- [ ] Email reminder batching (weekly digest of due follow-ups)
- [ ] Obsidian markdown projection (read-only view of contacts for iPhone via Obsidian)

## Search & Navigation

- [ ] Full-text search across contacts and interactions
- [ ] Keyboard shortcuts (vim-style navigation, quick capture)
- [ ] Tag/category filtering
- [ ] Timeline view of interactions
- [ ] Landing page: change `/` to render or redirect to `/contacts` once Contacts is the primary feature. Currently `/` renders the Sprint 02/03 health-check landing.
- [ ] Diacritic-insensitive search on contact list (e.g., "Muller" matches "Müller").
- [ ] Trash view: list soft-deleted contacts with option to restore or permanently delete.

## Sprint 03.5 — Status & Toast UI

- [ ] Toast notification system — non-fatal error toasts with "Copy debug info" button, auto-dismiss, stacking.
- [ ] System Status view (`/status` route) — integrity report, quarantined files list, iCloud conflicts, backup status, file watcher status.
- [ ] Header status indicator — green/yellow/red icon reflecting health, links to /status.
- [ ] Quarantine repair flow — view quarantined file content, delete permanently, attempt re-import.
- [ ] Log viewer UI — tail recent logs in-browser, filter by level, download log file.

## Data & Reliability

- [ ] Client/server fallback country alignment: server reads DEFAULT_COUNTRY env var; client hardcodes 'US'. Consider exposing server's default country via API so they stay in sync.
- [ ] Email validation strictness: server uses Zod `z.string().email()`; client does no pre-validation. Consider inline email format check on submit.
- [ ] Schema migration tooling (for future schemaVersion bumps)
- [ ] Conflict detection for iCloud sync races
- [ ] Backup verification (periodic integrity check of git backup)
- [ ] FileStore.findFileById uses substring match on UUID — technically loose (e.g., a file named "abc-<uuid>-def.json" would match). Consider exact-match validation in future hardening.
- [x] Per-entity schema versions (Sprint 04+) — replace single EXPECTED_SCHEMA_VERSION constant with per-entity version map when Contact and Interaction entities ship. *(Done in Sprint 04, ADR 012)*

## Polish

- [ ] Dark mode
- [ ] Responsive layout for various screen sizes
- [ ] Loading states and skeleton screens
- [ ] Accessibility audit (WCAG compliance)

## Sprint 05 Additions

- [ ] Edit interaction (PUT /api/interactions/:id + client form)
- [ ] GET /api/interactions/:id
- [ ] Per-interaction delete confirmation modal
- [ ] Atomic group-write for contact cascade delete (currently accepts partial failure) — see ADR 013
- [ ] Interaction metadata/tags field (revisit if extension needs emerge)
- [ ] Inbox capture format, parser, processing route — Sprint 06
- [ ] Apple Shortcut documentation for inbox capture — Sprint 06
- [ ] Review queue UI (list ambiguous inbox entries, resolve by selecting correct contact) — Sprint 06
- [ ] Decide final home for inbox processing trigger (status view, settings, contact list header) when inbox feature ships in Sprint 06

## Ideas (Not Yet Scoped)

- Relationship strength scoring based on interaction frequency
- Integration with calendar for auto-suggesting interaction logs
- Export to vCard format
