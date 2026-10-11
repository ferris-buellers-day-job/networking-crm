# Sprint 10 — Claude API Integration

## Goal

Given a resolved interaction (especially a messy, phone-dictated inbox note), David can press a "Summarize" button and receive an AI-generated clean summary plus a list of extracted follow-up actions. Both are persisted to the interaction record and displayed on its timeline entry.

After this sprint:
- The "Summarize" button appears on any interaction that has a `summary` field (the raw user-entered text that the AI will process).
- Pressing it calls the Anthropic API, parses and validates the structured JSON response, and persists `aiSummary` and `followUps` to the interaction's JSON file.
- The three UI states — in-progress, error+retry, success — are all rendered correctly.
- A failed call leaves the interaction exactly as it was.
- The **demo flow** works end-to-end: dictate a rambling note via the phone inbox, resolve it to a contact, trigger Summarize, see a clean summary and follow-ups on that contact's interaction timeline.

## Scope

### In
- `aiSummary: string | null` and `followUps: string[] | null` fields on `InteractionSchema` (additive nullable, current schema version).
- `POST /api/interactions/:id/summarize` route.
- `AnthropicClient` interface + production implementation (SDK-backed).
- `SummarizeService` that builds the prompt, calls the client, Zod-validates the response, retries once on malformed output, and persists to disk.
- Client affordance: "Summarize" button, three loading/error/success states, rendered summary and follow-ups.
- Full server-side test suite against a mock `AnthropicClient` (no real network).

### Out (explicitly deferred)
- Summarization of contacts, reminders, or any non-interaction entity.
- Automatic summarization on interaction log or inbox resolve — this sprint is manual-trigger only (ADR 003).
- Auto-creating `Reminder` entities from extracted follow-ups (follow-ups are text only this sprint).
- Multi-turn conversation, streaming, or pre-meeting brief generation.
- No `INTERACTION_SCHEMA_VERSION` bump — additive nullable fields only (see §Schema Changes).
- Citation linking: ADR 003 requires factual claims to cite `interactionId`. For a **single-interaction summary**, the summary is derived entirely from interaction X — the citation is implicit and the full ADR 003 citation rendering is deferred to the multi-interaction brief sprint.

**ADR 003 verbatim quotes (verify at Session 1 start):**

Manual-trigger basis — ADR 003 §Decision, constraint 1:
> "**Manual trigger only.** No automatic API calls. Every call comes from an explicit button press in the UI."

Citation deferral basis — ADR 003 §Decision, constraint 2:
> "**Traceable claims.** The prompt sent to Claude instructs it to cite, for every factual claim in its output, the `interactionId` that supports the claim. The UI renders these citations as clickable links that jump to the source interaction record. Any claim without a citation is flagged as 'unsupported' in the UI and excluded from the main brief body."

The citation constraint was written for multi-interaction briefs where the model synthesizes across records; for a single-interaction summary the claim-to-source mapping is implicit (the entire output is derived from one record). Full citation rendering is deferred accordingly. **Confirm at Session 1 start that these quotes still match the on-disk ADR 003 before writing any code.**

---

## Schema Changes

`server/schemas/interaction.ts` — additive nullable fields per ADR 016:

```typescript
export const InteractionSchema = BaseRecordSchema.extend({
  contactId:  z.string().uuid(),
  occurredAt: z.string().datetime(),
  type:       z.enum(['meeting', 'call', 'email', 'message', 'other']),
  summary:    z.string().max(10000).nullable(),   // existing: user-entered raw text
  location:   z.string().max(200).nullable(),
  // --- Sprint 10 additions ---
  aiSummary:  z.string().max(5000).nullable().default(null),
  followUps:  z.array(z.string().max(500)).nullable().default(null),
});
```

**`INTERACTION_SCHEMA_VERSION` stays at `1`.** The Sprint 09 migration infrastructure exists but is intentionally NOT exercised here. Adding optional nullable fields with `default(null)` is not a data transformation — existing on-disk records parse correctly without them because Zod coerces the absent key's `undefined` to `null`. Only a genuinely additive-incompatible change (non-null default, type change, rename) would require a migration and a version bump.

**Note on naming:** `summary` is the existing user-entered interaction summary (up to 10,000 chars); `aiSummary` is the AI-generated output (up to 5,000 chars). These are distinct fields. The AI uses `summary` as its primary input but they must not be confused in code or UI copy.

---

## Decision Points

Each is presented as a decision requiring explicit reviewer sign-off. My recommendation is stated; the reviewer may override.

---

### D1 — `followUps` field shape: `string[] | null` vs richer objects

**Option A — `string[] | null` (recommended):**
```typescript
followUps: z.array(z.string().max(500)).nullable().default(null)
```
Pros: simplest possible shape; easy to render as a bullet list; no premature structure. Cons: if we later auto-create Reminders from follow-ups, we'd need to parse strings (or add a migration to richer objects).

**Option B — Structured objects:**
```typescript
followUps: z.array(z.object({ text: z.string(), dueAt: z.string().datetime().nullable() })).nullable().default(null)
```
Pros: reminder-linking ready; `dueAt` already present if model extracts it. Cons: more complex prompt engineering for consistent structured output; pre-building structure for a deferred feature; validation surface grows.

**Recommendation: Option A.** Reminder creation is explicitly out of scope this sprint. Text strings are sufficient for display and can be migrated to richer objects via Sprint 09 infrastructure when the reminder-linking sprint lands.

---

### D2 — API client implementation: Anthropic SDK vs raw fetch

**Option A — `@anthropic-ai/sdk` npm package (recommended):**
Adds one dependency. Provides typed request/response, auth header handling, automatic retry on transient 529 overload responses, and named error classes (`APIError`, `AuthenticationError`, `RateLimitError`, `APIConnectionTimeoutError`) that map cleanly to our failure taxonomy. The injectable `AnthropicClient` interface wraps it, so tests never touch the SDK.

**Option B — Raw `fetch` to `https://api.anthropic.com/v1/messages`:**
No new dependency. Matches the client-side `apiFetch` pattern already in use. Requires manual auth headers, error classification, and retry logic.

**Recommendation: Option A.** This sprint ships the primary LLM integration. The SDK's error classification and typed responses are worth the dependency — they directly map to the four failure modes in §Failure Philosophy. The injectable interface seam means the dependency never appears in tests.

---

### D3 — Model selection and ID

Per the system context for this session, current Anthropic model IDs are:
- `claude-haiku-4-5-20251001` — fastest, cheapest
- `claude-sonnet-4-6` — balanced quality/cost
- `claude-opus-4-7` — highest capability

ADR 003 originally specified "Claude Sonnet." For summarizing a short phone-dictated note (typically < 500 words), Haiku is sufficient and substantially cheaper per call.

**Recommendation: `claude-haiku-4-5-20251001` as the default**, configurable via `ANTHROPIC_MODEL` environment variable. Reviewer should confirm this ID against [https://docs.anthropic.com/en/docs/about-claude/models](https://docs.anthropic.com/en/docs/about-claude/models) before shipping — model slugs change as new versions release, and the config env var is the escape hatch for bumping without a code change.

---

### D4 — Malformed response retry policy

The model is instructed to return JSON. Non-determinism guarantees occasional malformed output. Policy:

1. On first call: parse response text as JSON, Zod-validate against the response schema (see §System prompt shape).
2. If validation fails: **one parse-retry** with an amended system prompt that includes: `"Your previous response did not match the required shape. Return ONLY a JSON object with keys 'summary' (string) and 'followUps' (array of strings). No markdown, no preamble, no explanation."` plus the same user message.
3. If second response also fails validation: throw a retryable error. The interaction is unchanged.

**Note on retry layers:** The SDK's transport-layer auto-retry (for HTTP 429 rate-limit, 529 overload, and connection timeouts) and this parse-retry are orthogonal. The SDK may retry a transport failure up to its configured limit before the call returns to `SummarizeService`. The "one parse-retry" governs the application layer only — it is not the total attempt count across both layers.

**Recommendation: one parse-retry.** Zero retries is fragile given real malformed-output rates. Two or more parse-retries is wasteful; the cost (doubled latency and API spend per failed call) should be paid at most once at the application layer.

---

## Architecture

### `AnthropicClient` interface and DI seam

`server/lib/ai-client.ts`:

```typescript
export interface AnthropicClient {
  summarize(rawText: string): Promise<{ summary: string; followUps: string[] }>;
}
```

The production implementation (`AnthropicSdkClient`) holds an `Anthropic` SDK instance configured from `process.env.ANTHROPIC_API_KEY`. It is instantiated once in `server/index.ts` and injected into the summarize route — mirroring how `cacheDb` and `recentWrites` are injected into `FileStore`.

Tests pass a `MockAnthropicClient` (implements the interface, never calls the SDK).

**Missing key behaviour:** if `ANTHROPIC_API_KEY` is absent at startup, log a warning (`logger.warn`) but do not prevent the app from starting (the app is fully usable without AI). On any `summarize()` call with no key, `AnthropicSdkClient` throws immediately with a clear error message: `"AI summarization is not configured: ANTHROPIC_API_KEY is not set"`. This surfaces to the client as a **`503` with `retryable: false`** — retrying will never help because the key is absent from the environment; the fix is configuration, not a retry. The client renders this as an error state **without** a Retry affordance (distinct from transient failures, which do show Retry).

**Key handling invariants:**
- The key is read once from `process.env.ANTHROPIC_API_KEY` at SDK construction. It is never passed to `logger`, never included in request bodies, never written to the SQLite cache or any JSON file.
- `.env` is already in `.gitignore`; verify `.env.example` documents `ANTHROPIC_API_KEY=` as a placeholder.

### `SummarizeService`

`server/lib/summarize-service.ts` — orchestrates the full call:

1. Build system prompt and user message from the raw `summary` text of the interaction.
2. Call `AnthropicClient.summarize(rawText)`.
3. If success: atomically write `aiSummary` and `followUps` to the interaction's JSON file via the existing `FileStore.save()` path (which handles atomic write, Zod validation, and cache update).
4. If `AnthropicClient` throws: propagate as a `SummarizeError` (retryable); interaction is not modified.

### System prompt shape

The prompt instructs the model to return **only** a JSON object. Exact wording is an implementation detail; the contract is:
- System: instruct model to return `{ "summary": "...", "followUps": ["..."] }` as the entire response body, no markdown fencing, no preamble.
- User: the raw interaction `summary` text verbatim.
- `max_tokens: 1024` on every request — bounds cost and prevents a runaway response from consuming budget. A well-formed response (2–3 sentence summary + 3–5 follow-ups) fits comfortably within 500 tokens; 1024 is a conservative ceiling.
- A request timeout (e.g. 30 seconds) must be set so the UI spinner cannot hang indefinitely on a stalled connection. The SDK accepts a `timeout` option; the service should set it and treat `APIConnectionTimeoutError` as a transient retryable failure.

**Response Zod schema** — must be at least as strict as the storage schema so an over-limit response triggers the parse-failure retry path rather than a write-time surprise after a paid call:

```typescript
const SummarizeResponseSchema = z.object({
  summary:   z.string().min(1).max(5000),
  followUps: z.array(z.string().max(500)).max(20),
});
```

If the response fails this schema (e.g. summary too long, too many items, individual item exceeds 500 chars), it is treated identically to a malformed-JSON response: one retry with the amended nudge prompt, then a retryable error if the second response also fails.

### Route: `POST /api/interactions/:id/summarize`

```
POST /api/interactions/:id/summarize
Authorization: none (localhost-only; single-user)
Body: none
```

Responses:
- `200 OK` — updated interaction JSON (with `aiSummary` and `followUps` populated)
- `404 Not Found` — interaction not found or soft-deleted
- `503 Service Unavailable` — AI call failed, key missing, or parse failure after retry; body includes `{ error, retryable: true, debugInfo: { ... } }` per ADR 010

### Client affordance

New additions to the interaction detail/timeline view:
- **Idle:** "Summarize" button visible when `interaction.summary` is non-null and non-empty (the raw note exists to summarize). Button shows estimated model (e.g. "via Haiku").
- **In-progress:** button replaced by a spinner; no double-submit possible.
- **Error:** error message + "Retry" button; existing interaction content unchanged.
- **Success:** `aiSummary` rendered in a callout block; `followUps` as a bullet list; "Re-summarize" button replaces "Summarize" (prior AI output is overwritten on re-run).

---

## Failure Philosophy (mirrors Sprint 09 Failure 4)

A failed, timed-out, rate-limited, or malformed call leaves the interaction **exactly as it was before the call**. `aiSummary` and `followUps` are derived, disposable fields — the interaction JSON is the source of truth.

Two failure classes with distinct client behaviour:

**Transient failures** (rate limit, timeout, overload, malformed-after-retry) — `retryable: true`. The interaction is unchanged. The client renders an error message **with a Retry affordance**.

**Configuration failure** (missing `ANTHROPIC_API_KEY`) — `retryable: false`. The interaction is unchanged. The client renders an error message **without a Retry affordance** — retrying never helps; the fix is environment configuration.

In both cases:
- The service does **not** write `aiSummary = null` or `followUps = []` to signal "tried and failed." The field stays at whatever value it had before the call (null for first attempt, prior AI output for re-summarize).
- Partial writes never occur: `FileStore.save()` is atomic (ADR 007); if the write fails, the file is unchanged.
- The UI error state must include the copyable debug block (ADR 010).

**`followUps` tri-state** — the field has three meaningful states that Session 2's client must render distinctly:
- `null` — interaction has never been summarized; show "Summarize" button.
- `[]` — summarized; model found no follow-ups. Render "No follow-ups identified." Do not show an empty bullet list.
- `[...]` — summarized; items present. Render as a bullet list.

---

## Environment and Secrets

| Variable | Required | Purpose |
|---|---|---|
| `ANTHROPIC_API_KEY` | Yes (for AI features) | SDK authentication. Missing → app starts, AI returns 503. |
| `ANTHROPIC_MODEL` | No | Override model ID. Default: `claude-haiku-4-5-20251001`. |

Both are read-only env vars at runtime. Neither is ever written to disk, logged, or included in any persisted record.

`.env.example` must document both variables as placeholder stubs (no actual key values committed).

---

## Testing Contract

All tests run against the mocked `AnthropicClient`. No test makes a real network call. Any real-call smoke check is a manual script excluded from the test suite.

Required test cases (exact it-block titles to be assigned during implementation):

1. **Request shape:** mock captures arguments; assert model ID matches config, system prompt contains required keywords, user message is the interaction's raw `summary` text.
2. **Success path:** mock returns valid JSON; assert `aiSummary` and `followUps` persisted to interaction JSON on disk; assert HTTP 200 returns updated interaction.
3. **Malformed first response / valid second:** mock returns invalid JSON on first call, valid JSON on second; assert one retry fired; assert success.
4. **Malformed both responses:** mock always returns invalid JSON; assert HTTP 503 with `retryable: true`; assert interaction on disk unchanged (read back and compare).
5. **API error (e.g. rate limit):** mock throws; assert HTTP 503 with `retryable: true`; assert interaction unchanged.
6. **Missing key (non-retryable):** `AnthropicSdkClient` instantiated with no key; assert `summarize()` throws with message containing "not configured" before any HTTP call; assert the route returns `{ retryable: false }` (not `retryable: true`).
7. **Key never in logger or debugInfo:** spy on the logger; exercise an error path where the SDK throws an error whose message contains a key-like string (e.g. `sk-ant-test-FAKE`); assert (a) the key-like string does not appear in any argument passed to any `logger.*` call during the request; assert (b) the key-like string does not appear in the `debugInfo` block of the 503 response body. The `debugInfo` block is copy-pasteable per ADR 010, so a key leaking there is a real exfiltration path.
8. **Interaction not found:** route with unknown id returns 404; no AI call made.

---

## Session Plan

**Session 1 — Server:**
- Add `aiSummary` / `followUps` to `server/schemas/interaction.ts`
- `server/lib/ai-client.ts` — `AnthropicClient` interface + `AnthropicSdkClient` production implementation
- `server/lib/summarize-service.ts` — prompt build, call, Zod validate, retry, persist
- `POST /api/interactions/:id/summarize` wired into `server/routes/interactions.ts`
- Server tests (all 8 cases above) in `server/routes/interactions.test.ts` (summarize section) and `server/lib/summarize-service.test.ts`
- Install `@anthropic-ai/sdk` (if D2 approved)
- `.env.example` updated

**Session 2 — Client:**
- `client/lib/interactions-api.ts` — add `summarizeInteraction(id: string): Promise<Interaction>`
- Summarize button + three states on interaction timeline
- Client component tests for idle/loading/error/success state transitions
- Manual demo flow verification (end-to-end with real key in `.env`)
