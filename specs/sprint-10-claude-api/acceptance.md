# Sprint 10 — Acceptance Criteria

---

## Schema changes

- [ ] `InteractionSchema` in `server/schemas/interaction.ts` gains `aiSummary: z.string().max(5000).nullable().default(null)` and `followUps: z.array(z.string().max(500)).nullable().default(null)`.
  **Proven by:** `server/routes/interactions.test.ts` — success-path test reads back the interaction on disk after a summarize call and asserts both fields are present at expected values.

- [ ] `INTERACTION_SCHEMA_VERSION` remains `1`. No migration registered. Existing interaction records without `aiSummary` or `followUps` keys parse correctly (Zod coerces absent keys to `null` via `.default(null)`).
  **Proven by:** full test suite green (all pre-existing interaction route tests pass; no quarantine fires); additionally, a raw interaction fixture lacking both new keys is parsed by the schema in a dedicated schema-shape test and returns `aiSummary: null, followUps: null`.

---

## AnthropicClient interface and DI seam

- [ ] `server/lib/ai-client.ts` exports an `AnthropicClient` interface with a `summarize(rawText: string): Promise<{ summary: string; followUps: string[] }>` method.
  **Proven by:** the interface is the type used for the injected dependency in the route; TypeScript strict mode enforces the seam at compile time.

- [ ] A `MockAnthropicClient` implementing this interface is used in all server tests; no test calls `new Anthropic(...)` from the SDK directly.
  **Proven by:** grep of test files for `@anthropic-ai/sdk` returns no results (or import is only in `ai-client.ts`); test suite runs with no `ANTHROPIC_API_KEY` set.

- [ ] `AnthropicSdkClient` reads the API key from `process.env.ANTHROPIC_API_KEY` only. The key is never passed to any logger call, never written to any JSON file or the SQLite cache, and never appears in the `debugInfo` block of any 503 response body.
  **Proven by:** `server/routes/interactions.test.ts` — "key never in logger or debugInfo" test: spy on logger; SDK mock throws an error whose message contains a key-like string (e.g. `sk-ant-test-FAKE`); assert (a) that string does not appear in any argument to any `logger.*` call during the request; assert (b) that string does not appear in the `debugInfo` field of the 503 response body. The `debugInfo` block is copy-pasteable per ADR 010, so leaking a key there is a real exfiltration path.

- [ ] When `ANTHROPIC_API_KEY` is absent, `AnthropicSdkClient.summarize()` throws immediately with a message containing `"not configured"` before any HTTP call is attempted; the route returns `retryable: false` (not `retryable: true`); the client renders no Retry affordance.
  **Proven by:** `server/lib/summarize-service.test.ts` — "missing key (non-retryable)" test: client constructed with no key; `summarize()` rejects with the expected message; no network call made; route response body asserted `{ retryable: false }`.

---

## `POST /api/interactions/:id/summarize` route

- [ ] Returns `200 OK` with the full updated interaction JSON (including populated `aiSummary` and `followUps`) on a successful AI call.
  **Proven by:** `server/routes/interactions.test.ts` — "success path" test.

- [ ] Returns `404 Not Found` when the interaction id does not exist or is soft-deleted. No AI call is made.
  **Proven by:** `server/routes/interactions.test.ts` — "interaction not found" test: mock `summarize()` is asserted not called.

- [ ] Returns `503 Service Unavailable` with `{ error, retryable: true, debugInfo: { ... } }` when the AI call fails (any SDK error, rate limit, timeout) or when malformed output persists after one retry.
  **Proven by:** `server/routes/interactions.test.ts` — "API error" and "malformed both responses" tests.

---

## Structured output and parse-failure policy

- [ ] The service Zod-validates the model's response against `z.object({ summary: z.string().min(1).max(5000), followUps: z.array(z.string().max(500)).max(20) })` before writing anything to disk. A response that exceeds storage limits (e.g. summary > 5000 chars, item > 500 chars, array > 20 items) fails this schema and routes through the parse-failure retry path.
  **Proven by:** `server/lib/summarize-service.test.ts` — "malformed first response / valid second" test: first mock response fails schema (e.g. invalid JSON or over-limit field); assert retry fired; second response valid; assert success.

- [ ] On a malformed first response, exactly one retry is attempted with an amended prompt. If the second response is valid, the call succeeds.
  **Proven by:** `server/lib/summarize-service.test.ts` — "malformed first response / valid second" test: mock call count asserted to equal 2.

- [ ] If both responses fail Zod validation, a retryable error is thrown and nothing is written to disk.
  **Proven by:** `server/lib/summarize-service.test.ts` — "malformed both responses" test: interaction file read back from disk; `aiSummary` and `followUps` are unchanged from their pre-call values.

---

## Failure philosophy

- [ ] A transient failed call (SDK error, timeout, rate limit, parse failure after retry) returns `retryable: true`; the interaction JSON on disk is **byte-for-byte identical** to its pre-call state. `aiSummary` and `followUps` are not overwritten with `null`, empty strings, or any partial value.
  **Proven by:** `server/routes/interactions.test.ts` — "API error" test: interaction JSON read from disk after 503 response; response body asserted `{ retryable: true }`; compared to fixture pre-call state.

- [ ] A configuration failure (missing `ANTHROPIC_API_KEY`) returns `retryable: false`. The interaction is unchanged. The client renders no Retry affordance.
  **Proven by:** `server/lib/summarize-service.test.ts` — "missing key (non-retryable)" test; `server/routes/interactions.test.ts` — corresponding route assertion.

- [ ] The `FileStore.save()` atomic write path (ADR 007) is used for all persists; a failed disk write does not leave a partial file.
  **Proven by:** existing atomic-write guarantees from Sprint 02/Sprint 09 infrastructure; no new test required for this property specifically.

- [ ] `followUps: null` (never summarized), `followUps: []` (summarized, no follow-ups found), and `followUps: [...]` (summarized, items present) are all valid states. The client renders them distinctly: null shows the "Summarize" button; `[]` renders "No follow-ups identified." (not an empty list); `[...]` renders a bullet list.
  **Proven by:** client component tests — three distinct renders asserted for null, empty-array, and populated-array states.

---

## Request shape

- [ ] The AI call uses the configured model ID (default: `claude-haiku-4-5-20251001`, overridable via `ANTHROPIC_MODEL` env var).
  **Proven by:** `server/lib/summarize-service.test.ts` — "request shape" test: mock captures the model argument; asserts it equals the configured value.

- [ ] Every request includes `max_tokens: 1024` as a cost-and-correctness bound.
  **Proven by:** `server/lib/summarize-service.test.ts` — "request shape" test: mock captures full request options; asserts `max_tokens === 1024`.

- [ ] Every request includes a request timeout (e.g. 30 seconds); a `APIConnectionTimeoutError` from the SDK surfaces as a transient retryable 503.
  **Proven by:** `server/lib/summarize-service.test.ts` — "request shape" test: mock captures timeout option; asserts it is set. Timeout error path covered by the "API error" test (mock throws `APIConnectionTimeoutError`; asserts `retryable: true`).

- [ ] The user message sent to the model is the interaction's existing `summary` field (the raw user-entered text), not any AI-generated content or other field.
  **Proven by:** `server/lib/summarize-service.test.ts` — "request shape" test: mock captures the `rawText` argument; asserts it equals `interaction.summary`.

---

## Environment and secrets

- [ ] `.env.example` documents `ANTHROPIC_API_KEY=` and `ANTHROPIC_MODEL=` as placeholder stubs with no real values.
  **Proven by:** file inspection (`.env.example` in repo root).

- [ ] `.env` is already listed in `.gitignore`; confirm it remains so after Sprint 10 changes.
  **Proven by:** `git check-ignore .env` returns `.env`.

---

## Scope boundary

- [ ] `CONTACT_SCHEMA_VERSION`, `INTERACTION_SCHEMA_VERSION`, `INBOX_ENTRY_SCHEMA_VERSION`, and `REMINDER_SCHEMA_VERSION` all remain `1` after this sprint.
  **Proven by:** full test suite green; grep of all `*_SCHEMA_VERSION` constants in `server/schemas/`.

- [ ] No `Reminder` entities are auto-created from extracted follow-ups. `followUps` is text only.
  **Proven by:** route and service code: no import of reminder schema or reminder store in summarize paths.

- [ ] All pre-existing interaction route tests pass without modification.
  **Proven by:** full suite green; no changes to existing interaction test fixtures.

---

## Client affordance

- [ ] A "Summarize" button is visible on an interaction when `interaction.summary` is non-null and non-empty.
  **Proven by:** client component test — renders with a non-null summary; asserts button present.

- [ ] The button is not rendered when `interaction.summary` is null or empty (nothing to summarize).
  **Proven by:** client component test — renders with null summary; asserts button absent.

- [ ] While the summarize call is in-flight, the button is replaced by a spinner and cannot be double-submitted.
  **Proven by:** client component test — fires button click, asserts spinner visible and button absent before mock resolves.

- [ ] On success, `aiSummary` is rendered in a callout block and `followUps` as a bullet list on the interaction timeline.
  **Proven by:** client component test — mock API call resolves with populated fields; asserts both rendered.

- [ ] On a transient error (`retryable: true`), an error message **with** a "Retry" button is rendered; the pre-call interaction content remains visible and unchanged.
  **Proven by:** client component test — mock API call rejects with `retryable: true`; asserts error message and retry button present; asserts prior content unchanged.

- [ ] On a configuration error (`retryable: false`), an error message is rendered **without** a "Retry" button.
  **Proven by:** client component test — mock API call rejects with `retryable: false`; asserts error message present; asserts retry button absent.

- [ ] `followUps: null` renders the "Summarize" button (not yet summarized); `followUps: []` renders "No follow-ups identified." (not an empty list); `followUps: [...]` renders a bullet list.
  **Proven by:** client component tests — three distinct renders for null, empty-array, and populated-array `followUps` values.

---

## Demo flow (required end-to-end criterion — sprint not done until this passes)

**"Dictate, resolve, summarize":**

1. Dictate a multi-sentence, rambling phone note via the Apple Shortcut inbox capture (e.g. "uh so I talked to Sarah um she mentioned she wants the intro to the Berkeley person and also she was asking about the conference in October and I said I'd send her the link and we should probably grab coffee before the end of the month").
2. On the Mac app, open `/inbox`, find the pending entry, and resolve it to the correct contact.
3. Navigate to that contact's page; confirm the interaction appears in the timeline with the raw note as `summary`.
4. Press "Summarize" on that interaction.
5. Observe: spinner while in-flight; on completion, a clean 2–3 sentence `aiSummary` and a bullet list of `followUps` appear on the timeline entry.
6. Verify the interaction JSON on disk (in iCloud Drive) contains populated `aiSummary` and `followUps` fields.

**Proven by:** manual walkthrough by David in the running app with a real `ANTHROPIC_API_KEY` in `.env`. This criterion cannot be satisfied by automated tests alone.
