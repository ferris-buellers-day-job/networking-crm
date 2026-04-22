# Sprint 01 — Acceptance Criteria

Check each box when met. Claude Code should update this file as items complete.

## Repository
- [ ] Git repo initialized at `~/ClaudeProjects/networking-crm/`.
- [ ] Private GitHub remote configured; initial commit pushed.
- [ ] `.gitignore` covers: `node_modules/`, `.env`, `.env.local`, `.env.*.local`, `dist/`, `build/`, `.vite/`, `data/`, `*.db`, `*.db-journal`, `*.db-wal`, `*.db-shm`, `logs/`, `*.log`, `.DS_Store`, `.vscode/`, `.idea/`, `*.tsbuildinfo`.
- [ ] `LICENSE` file present ("All rights reserved").
- [ ] `README.md` with full setup instructions (both fnm and direct-install Node paths), GitHub clone step, iCloud folder creation step, `.env` configuration, backup repo initialization, and a "Setup on a new Mac" section.
- [ ] `.nvmrc` contains `20`.

## Project scaffolding
- [ ] `package.json` with scripts: `dev`, `build`, `start`, `lint`, `typecheck`.
- [ ] `tsconfig.json` (client) with `strict: true`, target ES2022.
- [ ] `tsconfig.server.json` (server) with `strict: true`, module NodeNext.
- [ ] `vite.config.ts` configured for React with `client/` as the source root.
- [ ] `.env.example` committed with documented variables; `.env` ignored.
- [ ] `npm install` completes without errors.

## Server
- [ ] Express server in `server/index.ts` binds to `127.0.0.1` on `PORT` (default 3000).
- [ ] `GET /api/health` returns `{ ok: true, version, commit }`.
- [ ] Version is read from `package.json`; commit from `git rev-parse --short HEAD` (fails gracefully if not in a git repo).
- [ ] In dev mode, Express uses Vite dev middleware to serve the client.

## Client
- [ ] React app mounts at `/`.
- [ ] On mount, fetches `/api/health` and displays "Ready" (on success) or "Error — see debug" (on failure). Debug display is a stub for Sprint 01; full debug-formatted errors land in Sprint 03.

## Documentation
- [ ] `CLAUDE.md` at repo root (provided).
- [ ] `docs/vision.md` written (1-2 pages: problem, goals, what success looks like in 6 months, what this is not).
- [ ] `docs/architecture.md` written (stack, request flow, directory map, placeholder for data model details that land later).
- [ ] `docs/conventions.md` written (naming, commit format, TS patterns, SQL style).
- [ ] `docs/data-schema.md` stub present with note "Populated in Sprint 04 with first entity."
- [ ] `docs/decisions/_template.md` present.
- [ ] ADRs 001-011 present (all provided).
- [ ] `backlog.md` seeded with at least: Apple Shortcut authoring guidance, iCloud folder structure, email reminder batching, ICS export, LinkedIn CSV import, Obsidian markdown projection, search, keyboard shortcuts.
- [ ] `CHANGELOG.md` has an entry dated for sprint close.

## Dev loop verification
- [ ] `npm run dev` starts the server and opens the browser.
- [ ] Browser loads the page without console errors.
- [ ] Network tab shows `/api/health` returning 200 with the expected body.
- [ ] Killing the process with Ctrl+C exits cleanly.

## Definition of done
All boxes above checked, the end-of-session documentation checklist from `CLAUDE.md` has been run, and the final commit has been pushed to GitHub.
