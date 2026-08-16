# Sprint 07 — Acceptance Criteria

## Session 1

### Schema and migration safety

- [x] **No-quarantine load test (load-bearing):** a contact JSON file written to disk with NO `tier` key — exactly mirroring existing v1 contact files — is read through `FileStore` and parses to `tier: null` without throwing `FileStoreQuarantineError`. This test must write a raw JSON file directly to the temp contacts folder (bypassing `FileStore.save`) and read it back via `FileStore.get`, confirming the `.default(null)` coercion is the operative mechanism and no quarantine fires.
- [x] `CONTACT_SCHEMA_VERSION` remains `1` in `server/schemas/contact.ts`. *(code-existence check: verified)*
- [x] `docs/decisions/016-additive-nullable-fields.md` exists and covers: the `FileStore` quarantine behavior on version mismatch, the Zod `.default(null)` mechanism, when this pattern is safe vs. not, and the consequence that schema version bumps are blocked until migration infrastructure exists. *(doc-existence check: verified)*

### Server — contact create (`POST /api/contacts`)

- [x] Creating a contact without a `tier` field in the body returns a contact with `tier: null`.
- [x] Creating a contact with `tier: 'inner_circle'` returns a contact with `tier: 'inner_circle'`.
- [x] Creating a contact with `tier: 'active'` returns a contact with `tier: 'active'`.
- [x] Creating a contact with `tier: 'dormant'` returns a contact with `tier: 'dormant'`.
- [x] Creating a contact with a well-formed but out-of-enum tier value (e.g. `tier: 'platinum'`) returns 400 with a validation error on the `tier` field specifically — not the strict-mode unknown-field path (which rejects any key entirely absent from the schema).

### Server — contact update (`PUT /api/contacts/:id`)

- [x] Updating a contact with `tier: 'active'` sets the tier to `'active'` and returns the updated contact.
- [x] Updating a contact with `tier: null` clears the tier to `null`.
- [x] A PUT body that omits `tier` entirely leaves the existing tier unchanged. *(test starts from `tier: 'active'` so an accidental clear would be detectable)*
- [x] Updating with a well-formed but out-of-enum tier value (e.g. `tier: 'platinum'`) returns 400 with a validation error on the `tier` field specifically — not the strict-mode unknown-field path.

### Server — contact read (`GET /api/contacts`, `GET /api/contacts/:id`)

- [x] `GET /api/contacts` returns a `tier` field on each contact.
- [x] `GET /api/contacts/:id` returns the `tier` field on the contact.

### Client — contact form tier select

- [x] The contact form renders a tier select with four options: *(none)*, Inner Circle, Active, Dormant.
- [x] In create mode, submitting with no tier selected (*(none)*) creates a contact with `tier: null`.
- [x] In create mode, selecting "Inner Circle" and submitting creates a contact with `tier: 'inner_circle'`.
- [x] In edit mode, the tier select is pre-populated from the contact's existing tier value.
- [x] In edit mode, changing the tier and submitting updates the stored tier.
- [x] In edit mode, selecting *(none)* and submitting sets `tier: null` (clears the tier).

### Client — contact list tier badge

- [x] A tiered contact's row shows a tier badge with the correct label (Inner Circle / Active / Dormant).
- [x] An untiered contact's row shows no tier badge.

### Client — contact list tier filter

- [x] "All" (default) shows all contacts regardless of tier.
- [x] "Inner Circle" filter shows only contacts with `tier === 'inner_circle'`; no other contacts appear.
- [x] "Active" filter shows only contacts with `tier === 'active'`; no other contacts appear.
- [x] "Dormant" filter shows only contacts with `tier === 'dormant'`; no other contacts appear.
- [x] "Untiered" filter shows only contacts with `tier === null`; no tiered contacts appear.
- [x] Tier filter composes with text search as a genuine intersection: set up contacts such that the text filter alone returns contacts from multiple tiers (e.g. two contacts named "Alice Smith" and "Alice Jones" — one `active`, one `inner_circle` — plus a non-Alice `active` contact); assert that applying "Active" filter + query "alice" returns exactly the active "Alice" — the inner-circle "Alice" is excluded by the tier filter, and the non-Alice active contact is excluded by the text filter. Both predicates must be operative.

### Client — contact detail tier badge

- [x] A tiered contact's detail page shows the tier badge with the correct label.
- [x] An untiered contact's detail page shows no tier badge or tier label.
