# ADR 011: Portability and disaster recovery

**Status:** Accepted
**Date:** 2026-04-22

## Context
David will eventually replace his MacBook. A new machine should not be a crisis. Beyond that, the app must survive: accidental deletion of the code directory, iCloud sync issues, loss of API keys, and a full disk failure. Preparing for these up front costs little; dealing with them unprepared is painful.

## Decision
Four independent restore paths are always available:

1. **Code: GitHub private repo.** The code directory at `~/ClaudeProjects/networking-crm/` is a git working directory with a private GitHub remote. A fresh clone on any Mac reconstructs the codebase.

2. **Data: iCloud Drive.** Data lives in `~/Library/Mobile Documents/com~apple~CloudDocs/NetworkingCRM/`. Signing in to iCloud on a new Mac and waiting for download restores the data.

3. **Data backup: Local git repo.** `~/NetworkingCRM-backup/` maintains a daily-committed git history of the data directory, outside iCloud. Provides point-in-time recovery if iCloud corrupts or loses data. Not automatically pushed to a remote.

4. **Secrets: External secure storage.** The Anthropic API key is stored in a Google Drive file under a dedicated, MFA-protected email account that has never appeared in a data breach. The `.env` file is gitignored and recreated on each new Mac from this external source.

Setup reproducibility is enforced by the README, which documents the full new-Mac setup procedure. If the README is ever wrong, the next fresh clone will reveal it.

Node.js version is pinned via `.nvmrc`, managed by `fnm`. A new Mac installs `fnm`, runs `fnm install` from the project directory, and has the correct Node version without ambiguity.

Native dependencies (`better-sqlite3`) are rebuilt on `npm install` for the new machine's architecture. The `data/` directory is gitignored so the cache is rebuilt from JSON on first run.

## Consequences
**Easier:** a new-Mac setup is a 15-25 minute procedure with no surprises. Catastrophic failures are recoverable. There is no "only exists on one disk" state for any asset.

**Harder:** slight discipline — keep the README current, push to GitHub regularly, keep the API key in its designated location.

**New risks:** if the Mac's disk fails without warning and iCloud sync has not completed recent changes, those changes could be lost. The git backup mitigates this to within the last daily backup window.

## Alternatives considered
- **Time Machine as the only backup:** works, but entangles CRM recovery with full-machine recovery. Less surgical.
- **Push data backup repo to GitHub:** would add offsite backup but puts contact data on GitHub's servers. Rejected per privacy rules. David can opt in later with a self-hosted remote if desired.
- **Commit secrets to the repo encrypted:** adds complexity; introduces a dependency on the encryption tool; not needed for the threat model.
