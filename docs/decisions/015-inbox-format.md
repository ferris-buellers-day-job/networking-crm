# ADR 015: inbox.txt block format grammar

**Status:** Accepted
**Date:** 2026-06-28

## Context

The iPhone writes to `inbox.txt` via an Apple Shortcut; the Mac app reads and processes it. This is the only cross-device write protocol in the system — every other file is written exclusively by the Mac. The format must be simultaneously: (1) simple enough to assemble in an iOS Shortcut without custom code, (2) robust enough for the Mac parser to handle partial or malformed writes gracefully, (3) inspectable as plain text in the iOS Files app, and (4) stable enough that changing it requires deliberately updating the Shortcut (i.e. it should be a named contract, not an implementation detail).

## Decision

`---`-delimited key-value blocks. Each entry opens and closes with a line containing exactly `---`. Structured fields (`id`, `date`, `contact`, `type`, `location`) are single-line `key: value` pairs. `summary` is a trailing multi-line block — everything from the `summary:` line through the line before the closing `---`.

```
---
id: a3f7c2b1
date: 2026-06-28T15:30:00-07:00
contact: Alice Smith
type: meeting
location: Blue Bottle, Oakland
summary: Discussed Q3 roadmap.
We also covered the partnership proposal.
---
```

Required fields: `id` (8 hex chars, Shortcut-generated GUID prefix), `date` (ISO 8601 with offset), `contact` (free text). Optional: `type` (defaults to `meeting`), `location`, `summary`.

`summary` is a trailing block (not a single line) to support voice-dictated long text — the highest-value capture field must not produce a parse error due to a mid-sentence line break.

The `date` field uses the iPhone's local time with timezone offset (e.g. `-07:00`). The Mac parser converts it to UTC-Z before storing. The Mac never writes to `inbox.txt`; the Shortcut never writes to the JSON records.

## Consequences

**Easier:** the format is human-readable and inspectable in Files.app. Assembling it in a Shortcut requires only "Combine Text" — no scripting. The `---` delimiter is unambiguous (it cannot appear at the start of a contact name, summary sentence, or location string in normal usage).

**Harder:** changes to the format (adding or renaming a field) require updating the Shortcut on the iPhone. This constraint is load-bearing: treat the format as a versioned protocol, not a configuration value.

**Risks:** if the Shortcut appends a malformed block (e.g. a crash mid-write produces an unclosed `---`), the Mac parser produces a `parse_error` InboxEntry rather than silently losing the entry. The raw text is preserved in `rawText` for inspection.

## Alternatives considered

**JSON-lines (one JSON object per line):** machine-readable but not human-inspectable in Files.app; fragile if the Shortcut misescapes a quote or newline. Rejected.

**Single-line format (`[date] contact | type | summary`):** no natural support for optional fields or multi-line summaries; `|` in a location or summary breaks parsing. Rejected.

**CSV:** same delimiter-collision problem; requires quoting rules. Rejected.

**No `id` field; use `(date, contact)` as composite idempotency key:** two legitimate entries for the same person within the same minute would falsely deduplicate. Rejected in favor of a Shortcut-generated GUID prefix.
