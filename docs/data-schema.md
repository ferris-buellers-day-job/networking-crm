# Data Schema

Authoritative contract for every JSON record shape. Update this document whenever a schema changes.

## Common fields (all entities)

| Field | Type | Description |
|---|---|---|
| `id` | UUID string | Immutable primary identifier (UUID v4). Generated at creation; never changes. |
| `createdAt` | ISO 8601 UTC (`Z`) | When the record was created. |
| `updatedAt` | ISO 8601 UTC (`Z`) | When the record was last modified. |
| `deletedAt` | ISO 8601 UTC (`Z`) \| `null` | Soft-delete timestamp. `null` means the record is active. |
| `schemaVersion` | integer | Schema version. See ADR 016 for the policy on bumping this. |

All schemas are defined with Zod and validated on every read and write. See ADR 006 for data hygiene rules.

---

## Contact (`server/schemas/contact.ts`)

`CONTACT_SCHEMA_VERSION = 1`

| Field | Type | Required | Notes |
|---|---|---|---|
| `name` | string (1–200 chars) | Yes | Trimmed on write. Whitespace-only rejected. |
| `preferredName` | string (≤200) \| `null` | No | The name David actually uses in conversation. |
| `linkedinUrl` | string (URL, ≤500) \| `null` | No | Stored as-is; no scraping (ADR 002). |
| `phone` | string (≤50) \| `null` | No | Stored in E.164 format (ADR 009). |
| `defaultCountry` | string (ISO 3166-1 alpha-2, 2 chars) \| `null` | No | Used to parse ambiguous phone numbers. |
| `email` | string (≤254) \| `null` | No | Domain lowercased on write. |
| `company` | string (≤200) \| `null` | No | |
| `title` | string (≤200) \| `null` | No | Job title. |
| `notes` | string (≤50 000) \| `null` | No | Freeform. |
| `tier` | `'inner_circle'` \| `'active'` \| `'dormant'` \| `null` | No | Contact tier classification. `null` = untiered (default). See ADR 016 for why `schemaVersion` was not bumped when this field was added. |

---

## Interaction (`server/schemas/interaction.ts`)

`INTERACTION_SCHEMA_VERSION = 1`

| Field | Type | Required | Notes |
|---|---|---|---|
| `contactId` | UUID string | Yes | Reference to the Contact's `id`. Must be non-deleted at write time (ADR 006 §10). |
| `occurredAt` | ISO 8601 UTC (`Z`) | Yes | When the interaction took place. Stored in UTC; displayed in local timezone. |
| `type` | `'meeting'` \| `'call'` \| `'email'` \| `'message'` \| `'other'` | Yes | |
| `summary` | string (≤10 000) \| `null` | No | Freeform notes about the interaction. |
| `location` | string (≤200) \| `null` | No | |

---

## InboxEntry (`server/schemas/inbox-entry.ts`)

`INBOX_ENTRY_SCHEMA_VERSION = 1`

| Field | Type | Required | Notes |
|---|---|---|---|
| `rawId` | string (≤16) | Yes | The `id` field value from `inbox.txt`. Idempotency key for reprocessing. |
| `rawText` | string (≤6000) | Yes | The full `---`-delimited block as captured. |
| `status` | `'pending'` \| `'resolved'` \| `'discarded'` | Yes | |
| `matchState` | `'auto_matched'` \| `'ambiguous'` \| `'unmatched'` \| `'parse_error'` | Yes | |
| `parsedDate` | ISO 8601 UTC (`Z`) \| `null` | No | UTC-converted from the inbox entry's `date` field. |
| `parsedContact` | string (≤200) \| `null` | No | Free text from the `contact` field. |
| `parsedType` | `'meeting'` \| `'call'` \| `'email'` \| `'message'` \| `'other'` \| `null` | No | Defaults to `'meeting'` when absent or unrecognized. `null` on parse error. |
| `parsedSummary` | string (≤10 000) \| `null` | No | |
| `parsedLocation` | string (≤200) \| `null` | No | |
| `parseError` | string \| `null` | No | Human-readable parse error message. Non-null only when `matchState = 'parse_error'`. |
| `candidateContactIds` | UUID string[] | Yes | Populated when `matchState = 'ambiguous'`. Empty array otherwise. |
| `contactId` | UUID string \| `null` | No | Set when `status = 'resolved'`. |
| `interactionId` | UUID string \| `null` | No | Set when `status = 'resolved'` and an Interaction was created. |
