# ADR 014: Inbox contact-matching strategy

**Status:** Accepted
**Date:** 2026-06-28

## Context

When an inbox entry is processed, its free-text `contact` field must resolve to a stored Contact UUID so the resulting Interaction has a valid `contactId`. The `contact` field is typed on an iPhone via Shortcut or dictated by voice — it may be a full name, a preferred name, or a casual variant. The system must decide how to match this text against the contact list, what level of confidence counts as "auto-match," and what happens to entries that cannot be matched confidently.

## Decision

Exact case-insensitive match after normalization (lowercase, trim, collapse runs of whitespace to one space), checked against both `name` and `preferredName` of all non-deleted contacts.

- **Confident auto-match:** exactly one contact satisfies the match. Create the Interaction immediately; record the InboxEntry as `status: 'resolved'`, `matchState: 'auto_matched'`.
- **Ambiguous (→ review queue):** two or more contacts satisfy the match. Record InboxEntry as `status: 'pending'`, `matchState: 'ambiguous'`, `candidateContactIds` populated.
- **Unmatched (→ review queue):** zero contacts satisfy the match. Record InboxEntry as `status: 'pending'`, `matchState: 'unmatched'`.

No fuzzy matching, prefix matching, or soundex in Sprint 06.

## Consequences

**Easier:** no false-confidence risk. A match is either exactly one contact or it goes to the queue. The review queue is the graceful recovery path for all non-exact situations.

**Harder:** "Alice" will not auto-match a contact stored as "Alice Smith" unless the user types the full name or has set `preferredName: 'Alice'`. The Shortcut setup guide and voice-dictation tips address this by recommending the full name.

**Backlogged:** prefix matching (e.g. "Alice" → "Alice Smith" if unique) and fuzzy matching are deferred. They increase auto-match recall but introduce false-confidence risk when two contacts share a first name. Better suited to a future "smart match" iteration.

## Alternatives considered

**Prefix match ("Alice" matches "Alice Smith" if unique):** increases auto-match rate for informal capture, but false-confidence risk when two contacts share a first name (e.g. "Alice Zhang" and "Alice Murphy"). Deferred to backlog.

**Fuzzy/Levenshtein matching:** meaningful implementation effort; risk of wrong auto-matches silently polluting the interaction log. Deferred to backlog.

**Auto-create new contact on unmatched:** would produce duplicate contacts on typos or voice-dictation errors. Rejected; the review queue lets David select or discard manually.
