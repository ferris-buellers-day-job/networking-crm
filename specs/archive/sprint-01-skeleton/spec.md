# Sprint 01 — Skeleton

## Goal
Stand up a minimal, working full-stack skeleton. By the end, running `npm run dev` starts the app, opens a browser, and displays a page that successfully calls a backend API route. No persistence, no real features, no data hygiene yet — that is Sprint 02.

This sprint is deliberately small so the dev loop is proven before we add complexity.

## Scope (what's in)
1. Git repo initialized at `~/ClaudeProjects/networking-crm/`, connected to a private GitHub remote.
2. `.gitignore`, `LICENSE` ("All rights reserved"), and `README.md` in place.
3. `.nvmrc` pinning Node 20 (LTS).
4. `package.json` with scripts: `dev`, `build`, `start`, `lint`, `typecheck`.
5. TypeScript configured with `strict: true`, target ES2022, module NodeNext for the server, module ES2022 for the client.
6. Vite configured for the React client under `client/`.
7. Express server under `server/` that:
   - Binds explicitly to `127.0.0.1` on the port from `PORT` env var (default 3000).
   - Serves the Vite dev middleware in development.
   - Exposes `GET /api/health` returning `{ ok: true, version: <from package.json>, commit: <git sha> }`.
8. Minimal React page at `client/app.tsx` that fetches `/api/health` on mount and displays "Ready" or "Error — see debug" (debug block is stubbed for now; the full implementation lands in Sprint 03).
9. `.env.example` committed; `.env` gitignored.
10. A first commit pushed to GitHub.

## Scope (explicitly out)
- Any persistence (SQLite, JSON files, etc.) — Sprint 02.
- Zod validation, atomic writes, file watcher, logging — Sprint 02.
- Real error display, System Status view — Sprint 03.
- Any contact or interaction data model — Sprint 04.
- Styling beyond functional defaults — Sprint 11.
- Tests. Testing harness is added in Sprint 02 when there's logic worth testing.

## Directory layout (target)
```
~/ClaudeProjects/networking-crm/
├── .gitignore
├── .nvmrc
├── .env.example
├── LICENSE
├── README.md
├── CLAUDE.md
├── package.json
├── tsconfig.json
├── tsconfig.server.json
├── vite.config.ts
├── server/
│   ├── index.ts
│   └── routes/
│       └── health.ts
├── client/
│   ├── index.html
│   ├── main.tsx
│   └── app.tsx
├── docs/
│   ├── vision.md
│   ├── architecture.md
│   ├── conventions.md
│   ├── data-schema.md            (stub for now; populated in Sprint 04)
│   └── decisions/
│       ├── _template.md
│       ├── 001-local-web-app.md
│       ├── 002-no-linkedin-scraping.md
│       ├── 003-manual-llm-traceable.md
│       ├── 004-iphone-sync.md
│       ├── 005-json-source-sqlite-cache.md
│       ├── 006-data-hygiene.md
│       ├── 007-fail-loud.md
│       ├── 008-git-backup.md
│       ├── 009-i18n.md
│       ├── 010-debug-errors.md
│       └── 011-portability.md
├── specs/
│   └── sprint-01-skeleton/
│       ├── spec.md
│       ├── acceptance.md
│       └── notes.md
├── backlog.md
└── CHANGELOG.md
```

## Open questions for David before starting
1. Confirm port 3000 is fine, or pick another. *Default: 3000.*
2. Confirm Node 20 is acceptable (vs 22). *Recommendation: 20 LTS for stability.*

## Acceptance criteria
See `acceptance.md`.

## Working notes
Append decisions made during the sprint to `notes.md`. At sprint close, promote durable decisions to ADRs.

## Prompts to use with Claude Code this sprint
- *Session 1:* "Read `CLAUDE.md`, then `specs/sprint-01-skeleton/spec.md`. Implement scope items 1-5 (git init, gitignore, license, readme stub, nvmrc, package.json, tsconfig, vite config). Do not proceed past item 5. Before writing code, summarize your plan in 5-10 lines."
- *Session 2:* "Read `CLAUDE.md` and `specs/sprint-01-skeleton/spec.md` and `specs/sprint-01-skeleton/notes.md`. Implement scope items 6-8 (Vite + Express wiring, health route, React fetch). Summarize your plan before coding."
- *Closing session:* "Run the end-of-session documentation checklist from `CLAUDE.md`, then help me push to GitHub for the first time."
