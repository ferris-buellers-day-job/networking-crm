# Vision

## The Problem

Professional relationships are too valuable to leave to memory and scattered notes. LinkedIn is a shallow graph optimized for recruiters, not for genuine connection. Enterprise CRMs are overkill for an individual. Paper notebooks don't travel or search. Notes apps become graveyards.

The real problem: **context decay**. After every conversation, details fade. Six months later, you remember *that* you met someone, but not *what* you discussed, *what* they cared about, or *what* you promised to follow up on. The relationship atrophies from neglect, not intent.

## What This Is

A personal CRM for one user (David) to:

1. **Capture interactions** — quick logging from Mac or iPhone, minimal friction.
2. **Surface context before reconnecting** — see past conversations, mutual topics, open threads.
3. **Prompt timely follow-ups** — tier-based reminders (close contacts monthly, acquaintances quarterly).
4. **Generate relationship summaries on demand** — LLM-assisted, citation-backed, never ghostwriting.

It's a tool for *remembering*, not automating relationships.

## Design Principles

- **Local-first.** Data lives on-device (iCloud Drive for sync). No SaaS dependency.
- **Privacy-first.** No telemetry. No third-party analytics. No LinkedIn scraping.
- **Single-user.** No auth, no multi-tenancy, no collaboration features.
- **Manual capture.** AI assists with recall, never with outreach.
- **Fail loud.** Errors surface immediately. Silent data loss is unacceptable.

## What Success Looks Like in 6 Months

1. Every professional conversation is logged within 24 hours via a 30-second iPhone capture.
2. Before any reconnection call, David opens the CRM and instantly has context: last conversation date, topics discussed, open items, suggested questions.
3. Weekly reminder email lists contacts due for follow-up, sorted by tier.
4. If David switches Macs, full restore takes under 30 minutes (iCloud sync + clone repo).
5. Zero data loss incidents.

## What This Is Not

- **Not a product for others.** No onboarding, no support, no feature requests from external users.
- **Not a social network.** No feeds, no public profiles, no "connections."
- **Not a sales pipeline.** No deal stages, forecasting, or revenue tracking.
- **Not an email client.** Interactions are logged manually; the app doesn't read inboxes.
- **Not a communication tool.** It surfaces context; David writes his own messages.

## Success Metrics (Personal)

- Capture rate: >90% of meaningful professional conversations logged.
- Reconnection quality: subjective sense that follow-ups feel natural and informed.
- System trust: confidence that data is safe, searchable, and durable.
