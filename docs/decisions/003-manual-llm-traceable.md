# ADR 003: Manual-trigger LLM with traceable claims, no ghostwritten messages

**Status:** Accepted
**Date:** 2026-04-22

## Context
The CRM uses Claude Sonnet via the Anthropic API to generate pre-meeting briefs and "reach out" prompts. Two concerns shape how this integration must work: (a) API calls cost money and should not be accidental, and (b) hallucinations in a networking context are more damaging than in a coding context — inventing a fact about a real contact could lead David to reference something that never happened.

## Decision
Three constraints govern all LLM usage:
1. **Manual trigger only.** No automatic API calls. Every call comes from an explicit button press in the UI. The button shows an estimated cost based on the context being sent.
2. **Traceable claims.** The prompt sent to Claude instructs it to cite, for every factual claim in its output, the `interactionId` that supports the claim. The UI renders these citations as clickable links that jump to the source interaction record. Any claim without a citation is flagged as "unsupported" in the UI and excluded from the main brief body.
3. **No ghostwritten messages.** The LLM generates summaries of prior interactions, context reminders about the contact, and suggested open-ended questions David might ask. It does not draft messages to the contact.

## Consequences
**Easier:** predictable spending; David stays in the driver's seat of his voice; hallucination risk is bounded by the citation requirement.

**Harder:** UI must design citation rendering carefully; the prompt engineering for strict citation discipline requires effort in Sprint 07.

**New risks:** David may be tempted to relax these constraints over time. These rules exist in `CLAUDE.md` as hard rules to resist that drift.

## Alternatives considered
- **Automatic briefs on contact page load:** would be slick but costs money on every page view, and trains David to not think about when AI is being used.
- **LLM drafts messages:** initially appealing but undermines the personal nature of networking.
- **No citation requirement:** simpler prompt but unacceptable given the stakes of getting a fact wrong.
