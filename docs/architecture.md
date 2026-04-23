# Architecture

## Stack Overview

| Layer | Technology | Notes |
|-------|------------|-------|
| Runtime | Node.js 20 (LTS) | Managed via `fnm`, pinned in `.nvmrc` |
| Frontend | React + Vite | SPA, no SSR |
| Backend | Express | Serves API and static assets |
| Source of Truth | JSON files in iCloud Drive | One file per entity |
| Derived Cache | SQLite (`better-sqlite3`) | Disposable, rebuilt on demand |
| Validation | Zod | Every read/write validated |
| LLM | Anthropic API (Claude) | Manual trigger only |

## Request Flow (Development)

```
Browser
  │
  ▼
Express (127.0.0.1:3000)
  ├── /api/* → Route handlers → FileStore (JSON) + Cache (SQLite)
  └── /* → Vite dev middleware → React SPA
```

## Request Flow (Production)

```
Browser
  │
  ▼
Express (127.0.0.1:3000)
  ├── /api/* → Route handlers → FileStore (JSON) + Cache (SQLite)
  └── /* → Static files from dist/client/
```

## Directory Layout

```
~/ClaudeProjects/networking-crm/
├── client/                 # React SPA
│   ├── index.html
│   ├── main.tsx
│   └── app.tsx
├── server/                 # Express API
│   ├── index.ts
│   └── routes/
├── docs/                   # Project documentation
│   ├── vision.md
│   ├── architecture.md
│   ├── conventions.md
│   ├── data-schema.md
│   └── decisions/          # ADRs
├── specs/                  # Sprint specifications
│   ├── sprint-XX-name/
│   └── archive/
├── data/                   # Local (gitignored)
│   ├── cache.db
│   └── logs/
├── dist/                   # Build output (gitignored)
├── CLAUDE.md
├── package.json
└── tsconfig*.json
```

## Data Directory (iCloud Drive)

```
~/Library/Mobile Documents/com~apple~CloudDocs/NetworkingCRM/
├── contacts/               # One JSON file per contact
├── interactions/           # One JSON file per interaction
├── inbox.txt               # iPhone capture buffer
└── .quarantine/            # Invalid files moved here
```

## Data Model

Detailed schemas are documented in `data-schema.md`. High-level entities:

- **Contact** — a person in the network
- **Interaction** — a logged conversation or meeting
- **ActionItem** — a follow-up task tied to a contact or interaction

All entities share common fields: `id` (UUID), `createdAt`, `updatedAt`, `deletedAt`, `schemaVersion`.

## Key Architectural Decisions

See `docs/decisions/` for full ADRs. Highlights:

- **ADR 005**: JSON is source of truth; SQLite is a disposable cache.
- **ADR 006**: Strict data hygiene — UUIDs, soft deletes, Zod validation.
- **ADR 007**: Atomic writes (write-to-temp, fsync, rename).
- **ADR 003**: LLM calls are manual-trigger only; no auto-generation.
- **ADR 004**: iPhone captures to `inbox.txt`; Mac is sole processor.
