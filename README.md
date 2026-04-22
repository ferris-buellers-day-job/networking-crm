# Networking CRM

A personal networking CRM for tracking professional relationships. Single-user, local-first, privacy-first. Runs on macOS, syncs capture from iPhone via Apple Shortcuts + iCloud Drive.

Not intended for redistribution. All rights reserved.

## First-time setup (existing Mac)

### Prerequisites

1. **Homebrew.** If you don't have it, install from [brew.sh](https://brew.sh/).
2. **Git.** Usually pre-installed on macOS. Check with `git --version`.
3. **Node 20+ via `fnm`** (recommended) or direct install.

   **Recommended (fnm):**
   ```bash
   brew install fnm
   # Then follow the shell setup instructions printed by the installer.
   # For zsh (macOS default), add to ~/.zshrc:
   #   eval "$(fnm env --use-on-cd)"
   # Restart Terminal, then:
   fnm install 20
   ```

   **Alternative (direct):** Download Node 20 LTS from [nodejs.org](https://nodejs.org/).

### Clone and install

```bash
mkdir -p ~/ClaudeProjects
cd ~/ClaudeProjects
git clone <your-github-repo-url> networking-crm
cd networking-crm
fnm use     # Picks up .nvmrc if using fnm
npm install
```

### Create iCloud data folder

In Finder, navigate to iCloud Drive and create a folder called `NetworkingCRM`. The app will create subfolders (`contacts/`, `interactions/`, etc.) on first run.

### Configure environment

```bash
cp .env.example .env
# Open .env in your editor. Fill in:
# - ANTHROPIC_API_KEY (retrieve from your secure storage)
# - Verify DB_PATH, DATA_PATH, and BACKUP_PATH resolve correctly for your username
```

### Initialize backup repo

```bash
mkdir -p ~/NetworkingCRM-backup
cd ~/NetworkingCRM-backup
git init
cd -
```

The app's backup service will commit here daily. This is separate from the code repo.

### Run

```bash
cd ~/ClaudeProjects/networking-crm
npm run dev
```

Opens a browser tab at `http://localhost:3000`.

## Setting up the iPhone capture Shortcut

*(To be documented when Sprint 05 lands. Interim: manually edit `inbox.txt` in iCloud Drive via the Files app.)*

## Setup on a new Mac

Order of operations matters.

1. **Install Homebrew** from brew.sh.
2. **Install fnm:** `brew install fnm` and add the shell integration to `~/.zshrc`.
3. **Sign in to iCloud** and wait for iCloud Drive to fully sync. You should see `NetworkingCRM/` with your data files in the Files app or Finder before proceeding.
4. **Clone the repo:**
   ```bash
   mkdir -p ~/ClaudeProjects && cd ~/ClaudeProjects
   git clone <your-github-repo-url> networking-crm
   cd networking-crm
   fnm use && npm install
   ```
5. **Restore `.env`:** Retrieve your `ANTHROPIC_API_KEY` from your secure storage (Google Drive file with MFA, password manager, etc.). `cp .env.example .env` and paste in the key.
6. **Restore backup repo (optional but recommended):** If your `~/NetworkingCRM-backup/` was backed up separately (e.g., to an external drive or another cloud), restore it. Otherwise, initialize a fresh one — you'll lose historical git-backup diffs but your current data is intact in iCloud.
7. **Run:** `npm run dev`. The app will rebuild its SQLite cache from the JSON files on first launch (may take a few seconds).

Expected total time: 15-25 minutes assuming iCloud has finished syncing.

## Disaster recovery

Three independent backups protect your data:

1. **iCloud Drive** — real-time, automatic. Covers device loss.
2. **Git backup repo** at `~/NetworkingCRM-backup/` — daily automated commits. Covers accidental deletions and iCloud conflicts.
3. **GitHub (code only)** — covers loss of the code, not the data.

If iCloud Drive corrupts or loses data, restore from the git backup: `cd ~/NetworkingCRM-backup && git log` to find the last good commit, then restore to the iCloud Drive folder.

If the SQLite cache corrupts: delete it (`rm data/cache.db*`) and restart the app. It rebuilds from the JSON files.

## Project documentation

- `CLAUDE.md` — context for Claude Code sessions. Read this first.
- `docs/vision.md` — the "why."
- `docs/architecture.md` — how it's built.
- `docs/decisions/` — architectural decision records.
- `specs/` — sprint specifications.
- `CHANGELOG.md` — what has shipped.
