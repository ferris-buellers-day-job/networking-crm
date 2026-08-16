# Sprint 07 — Contact Tiers

## Goal

Ship contact tier classification. After this sprint:

- Every contact has an optional tier: `inner_circle`, `active`, or `dormant`. New and existing contacts start untiered (`null`).
- The contact form lets David set or clear a tier on create and edit.
- The contact list shows a tier badge on each row and a tier filter that composes with the existing text search.
- The contact detail page shows the tier badge.
- ADR 016 records the project-wide decision on adding nullable fields without schema version bumps — this is now the precedent for all future additive schema changes until migration infrastructure exists.

## Scope (what's in)

### 1. ContactSchema tier field

Add `tier` to `ContactSchema` in `server/schemas/contact.ts`:

```typescript
tier: z.enum(['inner_circle', 'active', 'dormant']).nullable().default(null),
```

**`CONTACT_SCHEMA_VERSION` stays at 1. Do not bump it.**

The `.default(null)` coercion is the load-bearing mechanism: when Zod parses an existing contact JSON file that has no `tier` key, the missing field is `undefined`, which Zod's `.default(null)` converts to `null` before validation. The file passes, the record loads as `tier: null`, and no quarantine fires. This is verified directly by an acceptance test (see acceptance.md). See ADR 016 for the full design decision.

Tier values and their meanings:

| Value | Display label | Meaning |
|---|---|---|
| `inner_circle` | Inner Circle | Mentors, close collaborators; high-frequency, high-value contacts |
| `active` | Active | Regular professional contacts maintained intentionally |
| `dormant` | Dormant | People met but not currently nurturing |
| `null` | *(untiered)* | No classification assigned; the default for all contacts |

The `Contact` type inferred by Zod gains `tier: 'inner_circle' | 'active' | 'dormant' | null`.

**Single source of truth for tier values:** The display labels used by the form select options, the list tier filter, and the tier badge must all derive from a single exported constant — specifically, a `TIER_LABELS` map of type `Record<NonNullable<Contact['tier']>, string>` and, if needed, a companion `TIER_VALUES` tuple for iteration. Do not hardcode "Inner Circle", "Active", "Dormant" in three independent places. Adding a future tier must require updating exactly one map.

Update `docs/data-schema.md` to add `tier` to the Contact schema table.

### 2. Server — contact create and update accept tier

`server/routes/contacts.ts`:

Add `tier` to the shared `UserSettableFields` base object:

```typescript
tier: z.enum(['inner_circle', 'active', 'dormant']).nullable().optional(),
```

Because `ContactCreateSchema` and `ContactUpdateSchema` both derive from `UserSettableFields`, tier is accepted by both POST and PUT with no further schema changes. Unknown tier values still return 400 (Zod `.enum()` rejects them).

**POST /api/contacts handler:** add `tier: input.tier ?? null` when constructing the new `Contact` object.

**PUT /api/contacts/:id handler:** add `tier: 'tier' in input ? (input.tier ?? null) : existing.tier` when constructing the updated `Contact` object. Omitting `tier` from the body leaves the existing tier unchanged.

**`GET /api/contacts` and `GET /api/contacts/:id` are unchanged.** No query parameters are added. The `tier` field is returned automatically as part of each `Contact` object. Tier filtering is client-side (see Section 4).

### 3. Contact form — tier select

`client/pages/contact-form.tsx`:

Add a tier `<select>` field to both create and edit modes. Options:

| Option label | Value sent |
|---|---|
| *(none)* | `null` |
| Inner Circle | `'inner_circle'` |
| Active | `'active'` |
| Dormant | `'dormant'` |

In edit mode, the select is pre-populated from the fetched contact's `tier`. Selecting *(none)* sends `null`, clearing the tier. The tier field is included in the POST or PUT body alongside all other fields.

### 4. Contact list — tier badge and client-side tier filter

`client/pages/contact-list.tsx`:

**Tier badge:** display a tier badge inline with the contact's name in the list row. Untiered contacts show no badge. Badge CSS classes:

- `.tier-badge` (base)
- `.tier-badge--inner_circle`
- `.tier-badge--active`
- `.tier-badge--dormant`

**Tier filter:** add a tier filter control (a `<select>`) above or adjacent to the existing text search input. Filter states:

| Label | State value | Predicate |
|---|---|---|
| All | `null` | No filter (default) |
| Inner Circle | `'inner_circle'` | `contact.tier === 'inner_circle'` |
| Active | `'active'` | `contact.tier === 'active'` |
| Dormant | `'dormant'` | `contact.tier === 'dormant'` |
| Untiered | `'untiered'` | `contact.tier === null` |

**Composition with existing text search:** tier filter applies after the text search. Both operate on the already-fetched contacts array:

```typescript
const afterTextSearch = contacts.filter(textSearchPredicate(query));
const afterTierFilter  = afterTextSearch.filter(tierFilterPredicate(tierFilter));
```

Sort (name ascending, case-insensitive) is unchanged. Empty state ("No contacts yet.") and no-results state remain as-is.

### 5. Contact detail — tier badge

`client/pages/contact-detail.tsx`:

Display the tier badge (same markup and CSS classes as the list) when `contact.tier` is non-null. Untiered contacts show nothing for the tier field — absence is sufficient, no "(Untiered)" label.

### 6. Client Contact type

`client/lib/contacts-api.ts`:

Add `tier: 'inner_circle' | 'active' | 'dormant' | null` to the `Contact` interface. No other changes to this file.

### 7. ADR 016 — Additive nullable fields via Zod defaults; version bumps deferred

`docs/decisions/016-additive-nullable-fields.md`:

Write ADR 016 covering all of the following:

**Context:** `FileStore.readAndValidate` (`server/lib/file-store.ts`) quarantines any record whose on-disk `schemaVersion` is lower than `expectedSchemaVersion`, with the error message `"Schema migration not yet implemented"`. The version check also fires in the other direction — a record whose `schemaVersion` is higher than expected is also quarantined. No sprint has ever bumped a schema version; `CONTACT_SCHEMA_VERSION`, `INTERACTION_SCHEMA_VERSION`, and `INBOX_ENTRY_SCHEMA_VERSION` are all 1. ADR 006 §3 describes migration functions that map older versions forward on read, but the infrastructure to run them does not exist.

**Decision:** Purely additive nullable fields — fields whose absence is semantically equivalent to `null` for every existing record — are added to a Zod schema using `.nullable().default(null)` at the current `schemaVersion`. This is safe because:
1. Zod's `.default(null)` coerces `undefined` (a missing key) to `null` before validation, so existing files without the field pass Zod without error.
2. No file is quarantined: the on-disk `schemaVersion` still matches `expectedSchemaVersion`.
3. The new field is written on the next save, so the file converges to the full schema over time without a forced migration pass.

**Applicability condition:** this pattern is only valid when the field's absence is equivalent to its `null` value for all existing records. It cannot be used for fields with non-null defaults, type changes, renames, removals, or structural changes. Those require proper migration infrastructure.

**Consequence:** until migration infrastructure is built, schema version bumps are blocked for all entities. All future schema additions must fit the "additive nullable with `.default(null)`" pattern or wait for the migration plumbing. This constraint must be revisited before any sprint that needs a non-nullable new field, a default-non-null field, or a type change.

**This ADR is now the project-wide precedent** for adding fields to existing schemas. Reference it whenever a new nullable field is added.

## Scope (explicitly out)

- Schema version bump (`CONTACT_SCHEMA_VERSION` stays at 1)
- Schema migration infrastructure (v1→v2 upgrade-on-read) — backlog
- Tier-based sorting of the contact list (sort stays name-only)
- Tier-driven behavior or automation (no reminders, no action items based on tier)
- Bulk re-tiering of multiple contacts
- Tiers as a separate entity with custom CRUD (fixed enum only)
- Reminders — deferred to a future sprint
- Action items — deferred to a future sprint

## Directory layout (target changes)

```
server/
└── schemas/
    └── contact.ts               (add tier field; CONTACT_SCHEMA_VERSION unchanged at 1)
└── routes/
    ├── contacts.ts              (add tier to UserSettableFields; POST/PUT handlers)
    └── contacts.test.ts         (tier create/update/get; no-quarantine load test)

client/
├── lib/
│   └── contacts-api.ts          (add tier to Contact interface)
├── pages/
│   ├── contact-form.tsx         (tier select field)
│   ├── contact-form.test.tsx    (tier select tests)
│   ├── contact-list.tsx         (tier badge + tier filter)
│   ├── contact-list.test.tsx    (tier badge + filter tests)
│   ├── contact-detail.tsx       (tier badge)
│   └── contact-detail.test.tsx  (tier badge tests)

docs/
├── decisions/
│   └── 016-additive-nullable-fields.md   (ADR 016 — new)
└── data-schema.md                        (add tier to Contact schema table)
```

## Interfaces

```typescript
// server/schemas/contact.ts — updated ContactSchema
export const CONTACT_SCHEMA_VERSION = 1;  // unchanged

export const ContactSchema = BaseRecordSchema.extend({
  name:          z.string().min(1).max(200),
  preferredName: z.string().max(200).nullable(),
  linkedinUrl:   z.string().url().max(500).nullable(),
  phone:         z.string().max(50).nullable(),
  defaultCountry: z.string().length(2).nullable(),
  email:         z.string().email().max(254).nullable(),
  company:       z.string().max(200).nullable(),
  title:         z.string().max(200).nullable(),
  notes:         z.string().max(50000).nullable(),
  tier:          z.enum(['inner_circle', 'active', 'dormant']).nullable().default(null),
});

// server/routes/contacts.ts — addition to UserSettableFields
tier: z.enum(['inner_circle', 'active', 'dormant']).nullable().optional(),

// client/lib/contacts-api.ts — Contact interface addition
tier: 'inner_circle' | 'active' | 'dormant' | null;

// client pages — shared display constants
const TIER_LABELS: Record<NonNullable<Contact['tier']>, string> = {
  inner_circle: 'Inner Circle',
  active:       'Active',
  dormant:      'Dormant',
};
```

## Backlog additions

Add to `backlog.md`:

- [ ] Build schema migration infrastructure (v1→v2 upgrade-on-read) — `FileStore.readAndValidate` quarantines on version mismatch with "Schema migration not yet implemented"; no schema version can be bumped until this exists (see ADR 016)

## Acceptance criteria

See `acceptance.md`.

## Session prompts

- *Session 1:* "Read CLAUDE.md, then specs/sprint-07-tiers/spec.md. Implement Sections 1–7 in order: ContactSchema tier field (Section 1), server route changes (Section 2), contact form tier select (Section 3), contact list tier badge and filter (Section 4), contact detail tier badge (Section 5), client Contact type (Section 6), and ADR 016 (Section 7). Update docs/data-schema.md. Do not implement anything outside the spec."
