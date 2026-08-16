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
- [ ] Build schema migration infrastructure (v1→v2 upgrade-on-read) — `FileStore.readAndValidate` quarantines on version mismatch with "Schema migration not yet implemented"; no schema version can be bumped until this exists (see ADR 016)
- [ ] Schema migration tooling (for future schemaVersion bumps)
- [ ] Conflict detection for iCloud sync races
- [ ] Backup verification (periodic integrity check of git backup)
- [ ] FileStore.findFileById uses substring match on UUID — technically loose (e.g., a file named "abc-<uuid>-def.json" would match). Consider exact-match validation in future hardening.
- [ ] Flaky test: `server/lib/file-watcher.test.ts` intermittently times out (pre-existing, Sprint 02) — investigate and stabilize so it isn't mistaken for a future regression.
- [x] Per-entity schema versions (Sprint 04+) — replace single EXPECTED_SCHEMA_VERSION constant with per-entity version map when Contact and Interaction entities ship. *(Done in Sprint 04, ADR 012)*

## Polish

- [ ] Dark mode
- [ ] Responsive layout for various screen sizes
- [ ] Loading states and skeleton screens
- [ ] Accessibility audit (WCAG compliance)
- [ ] Contact list tier badge a11y gap: badge and tier-filter dropdown option render identical label text (e.g. "Inner Circle") with no distinguishing affordance — a screen-reader user can't tell a row badge from a filter option. Add an `aria-label` or visually-hidden "Tier:" prefix to the badge element.

## Sprint 05 Additions

- [ ] Edit interaction (PUT /api/interactions/:id + client form)
- [ ] GET /api/interactions/:id
- [ ] Per-interaction delete confirmation modal
- [ ] Atomic group-write for contact cascade delete (currently accepts partial failure) — see ADR 013
- [ ] Interaction metadata/tags field (revisit if extension needs emerge)
- [x] Inbox capture format, parser, processing route — *(Done Sprint 06)*
- [x] Apple Shortcut documentation for inbox capture — *(Done Sprint 06)*
- [x] Review queue UI (list ambiguous inbox entries, resolve by selecting correct contact) — *(Done Sprint 06)*
- [ ] Decide final home for inbox processing trigger (status view, settings, contact list header)

## Sprint 06 Additions

- [ ] **rawId collision for id-less parse_error entries** — entries missing an `id` field all get `rawId=''` and collapse to a single record on reprocessing (second and later id-less malformed entries are silently skipped as duplicates). Needs a distinct fallback key, e.g. content hash of `rawText`.


- [ ] "Create new contact" flow from inbox review queue
- [ ] Fuzzy or prefix contact matching in inbox processing
- [ ] `GET /api/inbox/:id` — single inbox entry endpoint
- [ ] `PUT /api/inbox/:id` — edit parsed fields before resolving
- [ ] Discard confirmation modal in review queue
- [ ] Pagination or search within the review queue
- [ ] iCloud sync-lag retry on `inbox.txt` read
- [ ] Apple Watch Shortcut variant
- [ ] Per-entry pending-count badge on `/inbox` navigation link
- [ ] Apple Shortcut source export (share `.shortcut` file as a project asset)
- [ ] Dedicated InboxEntry failure state for storage errors during processing (currently overloaded onto `'unmatched'`)
- [x] Ambiguous inbox card: display actual candidate contact names — *(Done Sprint 06 session 2)*
- [ ] Test coverage: inbox card `parsedDate` locale formatting and `parsedSummary` 80-char truncation are rendered but unasserted (acceptance criterion line 77 remains open)

## Sprint 08 Additions

- [ ] Interaction-anchored reminders (complement contact-anchored reminders; optional field on Interaction)
- [ ] Dismissed/snoozed reminder states (extend status enum; deferred activation)
- [ ] Un-done (revert reminder from done status back to pending)
- [ ] Contact detail reminder widget (show upcoming reminders on /contacts/:id page)
- [ ] Reminder navigation badge (show count of overdue reminders in nav)
- [ ] Reminder creation metadata (track whether reminder was created manually or from interaction)

## Ideas (Not Yet Scoped)

- Relationship strength scoring based on interaction frequency
- Integration with calendar for auto-suggesting interaction logs
- Export to vCard format
