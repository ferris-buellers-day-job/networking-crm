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

## Sprint 03.5 — Status & Toast UI

- [ ] Toast notification system — non-fatal error toasts with "Copy debug info" button, auto-dismiss, stacking.
- [ ] System Status view (`/status` route) — integrity report, quarantined files list, iCloud conflicts, backup status, file watcher status.
- [ ] Header status indicator — green/yellow/red icon reflecting health, links to /status.
- [ ] Quarantine repair flow — view quarantined file content, delete permanently, attempt re-import.
- [ ] Log viewer UI — tail recent logs in-browser, filter by level, download log file.

## Data & Reliability

- [ ] Schema migration tooling (for future schemaVersion bumps)
- [ ] Conflict detection for iCloud sync races
- [ ] Backup verification (periodic integrity check of git backup)
- [ ] FileStore.findFileById uses substring match on UUID — technically loose (e.g., a file named "abc-<uuid>-def.json" would match). Consider exact-match validation in future hardening.
- [ ] Per-entity schema versions (Sprint 04+) — replace single EXPECTED_SCHEMA_VERSION constant with per-entity version map when Contact and Interaction entities ship.

## Polish

- [ ] Dark mode
- [ ] Responsive layout for various screen sizes
- [ ] Loading states and skeleton screens
- [ ] Accessibility audit (WCAG compliance)

## Ideas (Not Yet Scoped)

- Relationship strength scoring based on interaction frequency
- Integration with calendar for auto-suggesting interaction logs
- Export to vCard format
