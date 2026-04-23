# Sprint 01 — Working Notes

Decisions and deviations recorded during implementation.

## Vite + Express Integration: Pattern A vs Pattern B

Two patterns were considered for integrating Vite with Express:

**Pattern A — Vite standalone with proxy:**
- Run Vite dev server on port 5173
- Run Express API on port 3000
- Configure Vite to proxy `/api/*` requests to Express
- Simpler initial setup, but two processes to manage

**Pattern B — Express with Vite middleware:**
- Run Express on port 3000
- Import Vite and attach its dev middleware to Express
- Single process, single port
- Matches production topology (Express serves everything)

**Decision:** Pattern B. Rationale:
1. Single process simplifies the dev experience (`npm run dev` starts everything).
2. No CORS considerations since API and client share the same origin.
3. Production and development have the same request flow, reducing "works on my machine" surprises.
4. The spec explicitly called for "Express uses Vite dev middleware" (scope item 7).

The initial scaffolding commit (dc07e96) included a Vite proxy config from Pattern A exploration. This was removed in the server implementation commit (69335d3) when Pattern B was finalized.

## tsx watch + Vite temp-file restart loop

**Problem:** When running `tsx watch server/index.ts`, Vite's `createServer()` generates temporary timestamp files (`vite.config.ts.timestamp-*.mjs`) in the project root as part of its config loading. tsx detected these file creations/deletions and triggered server restarts in a tight loop, making the server unstable.

**Symptoms:** Server log showed rapid repeated restarts:
```
Server running at http://127.0.0.1:3000
[tsx] unlink in ./vite.config.ts.timestamp-1776900883295-d7a3b67328b94.mjs Restarting...
Server running at http://127.0.0.1:3000
[tsx] unlink in ./vite.config.ts.timestamp-1776900884142-5573e45dd9848.mjs Restarting...
(repeating every ~1 second)
```

**Fix:** Added `--ignore` flag to the dev script in package.json:
```json
"dev": "tsx watch --ignore './vite.config.ts.timestamp-*' server/index.ts"
```

This was applied in commit 69335d3.

## package-lock.json

The original spec's directory layout did not list `package-lock.json`, but it was committed as expected for any Node.js project. The lockfile ensures reproducible installs and is standard practice. No spec deviation — just an implicit expectation made explicit.

## .claude/settings.local.json

Claude Code creates `.claude/settings.local.json` for machine-specific settings (allowed/denied tool permissions, etc.). This file:
- Contains local machine state, not project configuration
- Should not be shared across machines or users
- Was added to `.gitignore` in commit 6e7c016

The global `.claude/settings.json` (if it existed) would also be local state, but currently only `settings.local.json` is generated.

## Commit sequence

1. `ab668c9` — docs: initial project documentation and sprint specs
2. `dc07e96` — chore: add project scaffolding (sprint 01, items 1-5)
3. `d613427` — docs: add git push policy to coding conventions
4. `69335d3` — feat: add express server, health route, and react client (sprint 01, items 6-8)
5. `d155ae0` — docs: add vision, architecture, conventions, and complete sprint 01
6. `8a99916` — chore: archive sprint 01, update current sprint to 02
7. `6e7c016` — chore: ignore .claude/settings.local.json
