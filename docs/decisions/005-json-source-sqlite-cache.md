# ADR 005: JSON files as source of truth, SQLite as derived cache

**Status:** Accepted
**Date:** 2026-04-22

## Context
The CRM's data needs to sync between MacBook (full read/write) and iPhone (read-only). SQLite-over-iCloud is an established anti-pattern: iCloud Drive syncs files, not database transactions, and concurrent writes or mid-sync reads can silently corrupt the database. A pure SQLite approach forfeits iPhone read access. A real sync backend (Supabase, CloudKit) adds substantial complexity for a personal tool.

## Decision
Store all contact, interaction, tag, and action-item data as individual JSON files in a folder structure under `DATA_PATH` (inside iCloud Drive). The Mac app maintains a local SQLite cache at `CACHE_DB_PATH` (outside iCloud) as a derived view for fast querying. The cache is always rebuildable from the JSON files and is never authoritative. On startup, the Mac app checks JSON file modification times against the cache and re-indexes any changed files.

Folder structure:
```
DATA_PATH/
├── contacts/<slug>-<short-id>.json
├── interactions/<iso-timestamp>--<contact-slug>.json
├── tags.json
├── action-items.json
├── inbox.txt (appended by iPhone)
├── inbox-processed.txt (append-only audit)
├── obsidian/ (generated markdown for iPhone viewing; Sprint 09)
├── .quarantine/ (malformed files pulled out of active use)
└── .schema-version
```

## Consequences
**Easier:** iPhone can read individual files via Obsidian or the Files app. Data is human-readable and inspectable. Portability is essentially free. No sync backend to maintain.

**Harder:** more code than "just use SQLite" — file writes go through an atomic write utility, a cache-rebuild routine, and a file watcher. Multi-record operations are no longer atomic at the storage layer.

**New risks:**
- **Cache drift** if external file edits are missed. Mitigated by `chokidar` file watcher.
- **Orphaned references** (interaction pointing to nonexistent contact) since there are no foreign keys. Mitigated by referential integrity checks on cache rebuild.
- **iCloud conflict files** (`filename 2.json`). Mitigated by startup scan for conflict-pattern filenames.
- **Partial writes** if an atomic write is skipped. Mitigated by a strictly-enforced atomic write utility (ADR 007).

## Alternatives considered
- **Pure SQLite in iCloud:** anti-pattern per SQLite maintainers; silent corruption risk.
- **Pure SQLite outside iCloud:** no iPhone read access.
- **CloudKit:** Apple-platforms-only; poor fit for Node.js app.
- **Supabase/Firebase:** contact data in third-party DB; vendor lock-in; unnecessary for single-user tool.
- **Self-hosted sync server:** large complexity increase; ongoing maintenance.
