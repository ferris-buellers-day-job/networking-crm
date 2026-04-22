# ADR 004: iPhone sync — capture via Shortcut, read via Obsidian

**Status:** Accepted
**Date:** 2026-04-22

## Context
David needs to log contact interactions from his iPhone (e.g., immediately after meeting someone at a conference) and to review contact history on the go. Full two-way sync of a database across devices is complex and risky (see ADR 005 on why SQLite-in-iCloud doesn't work). A native iOS app is out of scope. Capture-only via text file is simple but gives no way to review existing data on iPhone.

## Decision
- **iPhone writes only to `inbox.txt`** via an Apple Shortcut that appends a timestamped entry. The Shortcut supports typed and dictated input.
- **iPhone reads via Obsidian.** The Mac app generates a parallel set of markdown files under `DATA_PATH/obsidian/` — one file per contact, with a rendered timeline of interactions. These are read-only from David's perspective (edits should go through the Mac app, not through Obsidian). Obsidian on iPhone reads the iCloud Drive folder natively.
- **Mac app reads the inbox, processes entries, and writes JSON records.** Once processed, inbox entries are moved to `inbox-processed.txt` (append-only audit log).
- **Mac app is the sole writer of JSON and markdown files.** iPhone never touches them.

## Consequences
**Easier:** zero mobile development; voice capture via Siri comes free; works offline; capture and review both supported on iPhone without building a mobile app.

**Harder:** processing inbox entries requires discipline; markdown projection is additional work (Sprint 09); if David edits markdown in Obsidian, those edits are lost on next regeneration (need to educate user and/or detect).

**New risks:**
- **Partial reads during iCloud sync:** low. Mitigated by atomic whole-file reads with retry.
- **User running the app on a second Mac:** would violate single-writer invariant. Mitigated by hard rule in `CLAUDE.md` and a lockfile check on startup.
- **User editing markdown in Obsidian:** edits will be overwritten on next projection regeneration. Mitigated by a prominent "READ-ONLY — edit in the Mac app" header at the top of every generated markdown file.

## Alternatives considered
- **Capture-only, no iPhone read access:** insufficient; David wants to review contacts on the go.
- **Full two-way sync with Supabase / Firebase / self-hosted backend:** 3-4x the build complexity; adds a backend to secure and maintain.
- **Native iOS app:** massive scope increase; App Store distribution; no Claude Code training-data advantage.
- **PWA served from Mac:** requires the Mac to be reachable from the phone (Tailscale, tunneling), reintroducing complexity.
- **Static HTML export for iPhone viewing:** works but less polished than Obsidian.
