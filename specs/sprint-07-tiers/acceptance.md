# Sprint 07 — Acceptance Criteria

## Session 1

### Schema and migration safety

- [ ] **No-quarantine load test (load-bearing):** a contact JSON file written to disk with NO `tier` key — exactly mirroring existing v1 contact files — is read through `FileStore` and parses to `tier: null` without throwing `FileStoreQuarantineError`. This test must write a raw JSON file directly to the temp contacts folder (bypassing `FileStore.save`) and read it back via `FileStore.get`, confirming the `.default(null)` coercion is the operative mechanism and no quarantine fires.
- [ ] `CONTACT_SCHEMA_VERSION` remains `1` in `server/schemas/contact.ts`.
- [ ] `docs/decisions/016-additive-nullable-fields.md` exists and covers: the `FileStore` quarantine behavior on version mismatch, the Zod `.default(null)` mechanism, when this pattern is safe vs. not, and the consequence that schema version bumps are blocked until migration infrastructure exists.

### Server — contact create (`POST /api/contacts`)

- [ ] Creating a contact without a `tier` field in the body returns a contact with `tier: null`.
- [ ] Creating a contact with `tier: 'inner_circle'` returns a contact with `tier: 'inner_circle'`.
- [ ] Creating a contact with `tier: 'active'` returns a contact with `tier: 'active'`.
- [ ] Creating a contact with `tier: 'dormant'` returns a contact with `tier: 'dormant'`.
- [ ] Creating a contact with a well-formed but out-of-enum tier value (e.g. `tier: 'platinum'`) returns 400 with a validation error on the `tier` field specifically — not the strict-mode unknown-field path (which rejects any key entirely absent from the schema).

### Server — contact update (`PUT /api/contacts/:id`)

- [ ] Updating a contact with `tier: 'active'` sets the tier to `'active'` and returns the updated contact.
- [ ] Updating a contact with `tier: null` clears the tier to `null`.
- [ ] A PUT body that omits `tier` entirely leaves the existing tier unchanged.
- [ ] Updating with a well-formed but out-of-enum tier value (e.g. `tier: 'platinum'`) returns 400 with a validation error on the `tier` field specifically — not the strict-mode unknown-field path.

### Server — contact read (`GET /api/contacts`, `GET /api/contacts/:id`)

- [ ] `GET /api/contacts` returns a `tier` field on each contact.
- [ ] `GET /api/contacts/:id` returns the `tier` field on the contact.

### Client — contact form tier select

- [ ] The contact form renders a tier select with four options: *(none)*, Inner Circle, Active, Dormant.
- [ ] In create mode, submitting with no tier selected (*(none)*) creates a contact with `tier: null`.
- [ ] In create mode, selecting "Inner Circle" and submitting creates a contact with `tier: 'inner_circle'`.
- [ ] In edit mode, the tier select is pre-populated from the contact's existing tier value.
- [ ] In edit mode, changing the tier and submitting updates the stored tier.
- [ ] In edit mode, selecting *(none)* and submitting sets `tier: null` (clears the tier).

### Client — contact list tier badge

- [ ] A tiered contact's row shows a tier badge with the correct label (Inner Circle / Active / Dormant).
- [ ] An untiered contact's row shows no tier badge.

### Client — contact list tier filter

- [ ] "All" (default) shows all contacts regardless of tier.
- [ ] "Inner Circle" filter shows only contacts with `tier === 'inner_circle'`; no other contacts appear.
- [ ] "Active" filter shows only contacts with `tier === 'active'`; no other contacts appear.
- [ ] "Dormant" filter shows only contacts with `tier === 'dormant'`; no other contacts appear.
- [ ] "Untiered" filter shows only contacts with `tier === null`; no tiered contacts appear.
- [ ] Tier filter composes with text search as a genuine intersection: set up contacts such that the text filter alone returns contacts from multiple tiers (e.g. two contacts named "Alice Smith" and "Alice Jones" — one `active`, one `inner_circle` — plus a non-Alice `active` contact); assert that applying "Active" filter + query "alice" returns exactly the active "Alice" — the inner-circle "Alice" is excluded by the tier filter, and the non-Alice active contact is excluded by the text filter. Both predicates must be operative.

### Client — contact detail tier badge

- [ ] A tiered contact's detail page shows the tier badge with the correct label.
- [ ] An untiered contact's detail page shows no tier badge or tier label.
