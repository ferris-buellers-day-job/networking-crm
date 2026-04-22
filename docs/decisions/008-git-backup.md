# ADR 008: Daily git backup of the data directory

**Status:** Accepted
**Date:** 2026-04-22

## Context
iCloud Drive is not a backup — it is a sync service. If a file is corrupted, deleted, or overwritten, the change propagates to every device. A true backup provides point-in-time recovery. For a single-user local tool with data David genuinely cares about, the cheapest and most useful backup is a local git repository separate from both the code repo and the iCloud data folder.

## Decision
- Maintain a second local git repo at `BACKUP_PATH` (default: `~/NetworkingCRM-backup/`), outside iCloud Drive and separate from the code repo.
- A backup service inside the Mac app runs once per app startup (and optionally on a daily timer if the app is left running). It:
  - Copies the contents of `DATA_PATH` (minus `inbox.txt` and the `.quarantine/` folder) into `BACKUP_PATH`.
  - Stages all changes and commits with a message like `backup: 2026-04-22` if there are any.
  - Skips the commit if nothing changed.
- The backup is local-only. It is not pushed to GitHub, because GitHub's acceptable use does not extend to private contact data at this volume and the threat model doesn't require offsite backup for this project.
- If David wants offsite backup later, he can configure the backup repo to push to a private remote he trusts. Not done by default.

## Consequences
**Easier:** point-in-time recovery for any record at any past day. `cd ~/NetworkingCRM-backup && git log` shows every change over time. If iCloud corrupts a file, the last good version is one `git show` away.

**Harder:** a second git repo to be aware of. Disk space — grows over time, but JSON text data is tiny; years of history should remain under 100MB.

**New risks:** if the Mac's disk fails catastrophically without warning, both the live data (via iCloud recovery) and the backup are lost simultaneously. Mitigated if David chooses to push the backup repo to a remote, but not required.

## Alternatives considered
- **Time Machine:** works, but not specific to this app; recovery requires full Mac backup restore. Git is more surgical.
- **iCloud snapshots / versioning:** iCloud Drive offers no user-accessible version history for folders.
- **Push backup to GitHub:** would provide offsite recovery but puts contact data on GitHub's servers. Not acceptable per the "treat contact data as sensitive" rule.
- **No backup:** unacceptable for data David cares about.
