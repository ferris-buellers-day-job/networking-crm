# Sprint 01 — Acceptance Criteria

Check each box when met. Claude Code should update this file as items complete.

## Repository
- [x] Git repo initialized at `~/ClaudeProjects/networking-crm/`.
- [x] Private GitHub remote configured; initial commit pushed.
- [x] `.gitignore` covers: `node_modules/`, `.env`, `.env.local`, `.env.*.local`, `dist/`, `build/`, `.vite/`, `data/`, `*.db`, `*.db-journal`, `*.db-wal`, `*.db-shm`, `logs/`, `*.log`, `.DS_Store`, `.vscode/`, `.idea/`, `*.tsbuildinfo`.
- [x] `LICENSE` file present ("All rights reserved").
- [x] `README.md` with full setup instructions (both fnm and direct-install Node paths), GitHub clone step, iCloud folder creation step, `.env` configuration, backup repo initialization, and a "Setup on a new Mac" section.
- [x] `.nvmrc` contains `20`.

## Project scaffolding
- [x] `package.json` with scripts: `dev`, `build`, `start`, `lint`, `typecheck`.
- [x] `tsconfig.json` (client) with `strict: true`, target ES2022.
- [x] `tsconfig.server.json` (server) with `strict: true`, module NodeNext.
- [x] `vite.config.ts` configured for React with `client/` as the source root.
- [x] `.env.example` committed with documented variables; `.env` ignored.
- [x] `npm install` completes without errors.

## Server
- [x] Express server in `server/index.ts` binds to `127.0.0.1` on `PORT` (default 3000).
- [x] `GET /api/health` returns `{ ok: true, version, commit }`.
- [x] Version is read from `package.json`; commit from `git rev-parse --short HEAD` (fails gracefully if not in a git repo).
- [x] In dev mode, Express uses Vite dev middleware to serve the client.

## Client
- [x] React app mounts at `/`.
- [x] On mount, fetches `/api/health` and displays "Ready" (on success) or "Error — see debug" (on failure). Debug display is a stub for Sprint 01; full debug-formatted errors land in Sprint 03.

## Documentation
- [x] `CLAUDE.md` at repo root (provided).
- [x] `docs/vision.md` written (1-2 pages: problem, goals, what success looks like in 6 months, what this is not).
- [x] `docs/architecture.md` written (stack, request flow, directory map, placeholder for data model details that land later).
- [x] `docs/conventions.md` written (naming, commit format, TS patterns, SQL style).
- [x] `docs/data-schema.md` stub present with note "Populated in Sprint 04 with first entity."
- [x] `docs/decisions/_template.md` present.
- [x] ADRs 001-011 present (all provided).
- [x] `backlog.md` seeded with at least: Apple Shortcut authoring guidance, iCloud folder structure, email reminder batching, ICS export, LinkedIn CSV import, Obsidian markdown projection, search, keyboard shortcuts.
- [x] `CHANGELOG.md` has an entry dated for sprint close.

## Dev loop verification
- [x] `npm run dev` starts the server and opens the browser.
- [x] Browser loads the page without console errors.
- [x] Network tab shows `/api/health` returning 200 with the expected body.
- [x] Killing the process with Ctrl+C exits cleanly.

## Definition of done
All boxes above checked, the end-of-session documentation checklist from `CLAUDE.md` has been run, and the final commit has been pushed to GitHub.
