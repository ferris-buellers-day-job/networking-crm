# Sprint 04 — Contacts

## Goal
Implement the first real entity: Contact. This sprint builds on the FileStore foundation from Sprint 02, adding a Zod schema, API endpoints, and React UI for CRUD operations. After this sprint, David can create, view, edit, list, search, and soft-delete contacts.

## Scope (what's in)

### 1. Contact schema and validation

Define the Contact entity with Zod:

```typescript
// server/schemas/contact.ts

export const CONTACT_SCHEMA_VERSION = 1;

export const ContactSchema = BaseRecordSchema.extend({
  name: z.string().min(1).max(200),
  preferredName: z.string().max(200).nullable(),
  linkedinUrl: z.string().url().max(500).nullable(),
  phone: z.string().max(50).nullable(),           // E.164 format
  defaultCountry: z.string().length(2).nullable(), // ISO 3166-1 alpha-2
  email: z.string().email().max(254).nullable(),
  company: z.string().max(200).nullable(),
  title: z.string().max(200).nullable(),
  notes: z.string().max(50000).nullable(),
});

export type Contact = z.infer<typeof ContactSchema>;
```

Field rules:
- `name`: Required. Trimmed before save. Whitespace-only rejected.
- `preferredName`: Optional. The name David actually uses (e.g., "Greg" when legal name is "Gregory").
- `linkedinUrl`: Optional. Stored string only — see Section 10 for no-scraping rule. URL validation requires protocol (`https://` or `http://`). Form does NOT auto-prefix. Error message: "LinkedIn URL must start with https:// or http://".
- `phone`: Optional. Stored in E.164 format. Parsed via `libphonenumber-js` on save.
- `defaultCountry`: Optional. ISO 3166-1 alpha-2 code (e.g., `US`, `GB`). Used for parsing ambiguous phone numbers.
- `email`: Optional. Domain portion lowercased on save (local part preserved per RFC). `Greg.Smith@EXAMPLE.com` → `Greg.Smith@example.com`.
- `company`: Optional.
- `title`: Optional. Job title.
- `notes`: Optional. Freeform text.

**Not included** (deferred):
- `metDate` / `howWeMet` — Sprint 05 (first Interaction serves as "how we met")
- `tier` — Sprint 06 (will be added via schema migration)

### 2. Per-entity schema versioning

FileStore already accepts `expectedSchemaVersion` as a per-instance constructor option (verified in Sprint 02 implementation). Sprint 04 passes `CONTACT_SCHEMA_VERSION` when constructing the contacts FileStore. No FileStore signature changes needed.

**Behavior change required:** Currently, FileStore logs a warning when `schemaVersion < expected` and proceeds with validation. Sprint 04 changes this to quarantine instead:

- If `schemaVersion > expected`: quarantine file (existing behavior).
- If `schemaVersion < expected`: quarantine file with reason `"Schema migration not yet implemented (found v{N}, expected v{M})"`.
- If `schemaVersion === expected`: proceed normally.

This is a small change to `server/lib/file-store.ts` lines 298-307.

**Deferred:** Actual migration logic for `schemaVersion < expected`. Add to backlog: "Schema migration strategy."

### 3. Storage.ts wiring

Construct `contactsStore` in `initStorage()`. This is the first real FileStore consumer.

```typescript
// In server/services/storage.ts initStorage()

import { ContactSchema, CONTACT_SCHEMA_VERSION } from '../schemas/contact.js';

const contactsStore = new FileStore<Contact>(
  path.join(dataPath, 'contacts'),
  ContactSchema,
  { cacheDb, logger, recentWrites },
  { expectedSchemaVersion: CONTACT_SCHEMA_VERSION }
);

// Expose via StorageContext
return {
  // existing fields...
  contactsStore,
};
```

Update `StorageContext` interface to include `contactsStore: FileStore<Contact>`.

### 4. Phone number normalization

Use `libphonenumber-js` (already in CLAUDE.md tech stack) to normalize phone numbers:

```typescript
// server/lib/phone.ts

import { parsePhoneNumber, isValidPhoneNumber } from 'libphonenumber-js';

/**
 * Parse and normalize a phone number to E.164 format.
 *
 * @param input - Raw phone input from user
 * @param defaultCountry - ISO 3166-1 alpha-2 code (e.g., 'US', 'GB')
 * @returns E.164 string (e.g., '+14155551234') or null if invalid
 */
export function normalizePhone(input: string | null | undefined, defaultCountry?: string): string | null;

/**
 * Format an E.164 phone number for display in the contact's locale.
 */
export function formatPhoneForDisplay(e164: string, defaultCountry?: string): string;
```

Behavior:
- `normalizePhone('', country)` returns `null` without error.
- `normalizePhone(null, country)` returns `null` without error.
- `normalizePhone(undefined, country)` returns `null` without error.
- Only non-empty unparseable input triggers a parse-fail `null` return.
- If input starts with `+`, parse as international.
- If no `+`, use `defaultCountry` from the contact, or fall back to `DEFAULT_COUNTRY` env var (default: `US`).

### 5. Contact API endpoints

```typescript
// server/routes/contacts.ts

GET    /api/contacts         // List all non-deleted contacts
GET    /api/contacts/:id     // Get single contact
POST   /api/contacts         // Create contact
PUT    /api/contacts/:id     // Update contact
DELETE /api/contacts/:id     // Soft delete contact
```

**GET /api/contacts**
- Returns array of all contacts where `deletedAt` is null.
- Sorted by `name` ascending, case-insensitive.
- Response: `{ contacts: Contact[] }`
- Note: FileStore's `getAll()` already skips quarantined files (logs warning, continues).

**GET /api/contacts/:id**
- Returns single contact by ID.
- 404 if not found or soft-deleted.
- Response: `{ contact: Contact }`

**POST /api/contacts**
- Creates new contact.
- Generates UUID, sets `createdAt`, `updatedAt`, `schemaVersion`.
- Validates and normalizes fields (phone → E.164, email domain → lowercase, name → trimmed).
- Returns 400 ValidationError if name is empty/whitespace-only or phone is unparseable.
- Response: `{ contact: Contact }` with 201 status.

**PUT /api/contacts/:id**
- Updates existing contact.
- Updates `updatedAt`.
- Same validation as POST.
- 404 if not found or soft-deleted.
- Response: `{ contact: Contact }`

**DELETE /api/contacts/:id**
- Soft delete: sets `deletedAt` to current timestamp.
- 404 if not found or already deleted.
- Response: 204 No Content.

### 6. Filename pattern

Contact JSON files use the pattern: `{id}.json`

Example: `contacts/a8f3c2d1-1234-5678-9abc-def012345678.json`

Human-readable slugs are intentionally omitted for contacts to avoid filename changes on rename. The `name` field is the display value; `id` is the filename.

### 7. React routes and navigation

Add client-side routing with `react-router-dom`:

```
/contacts         → ContactList (list all contacts)
/contacts/new     → ContactForm (create new)
/contacts/:id     → ContactDetail (view single contact)
/contacts/:id/edit → ContactForm (edit existing)
```

Navigation flow:
- List → click contact → Detail
- Detail → click "Edit" → Edit form
- List → click "New Contact" → New form
- New form → Save → navigate to Detail (`/contacts/:id`)
- Edit form → Save → navigate to Detail
- Detail → click "Delete" → confirmation modal → soft delete → navigate to List

### 8. Contact list UI

`client/pages/contact-list.tsx`:
- Fetches contacts from `GET /api/contacts` on mount.
- Displays contacts in a simple list/table.
- Shows `name` (or `preferredName` if set), `company`, `email`.
- Click row navigates to `/contacts/:id`.
- "New Contact" button navigates to `/contacts/new`.
- Loading state while fetching.
- Empty state: "No contacts yet. Create your first contact."

**Search:**
- Text input above the list.
- Client-side substring filter as you type.
- Searches across: `name`, `preferredName`, `company`, `email`.
- Does NOT search `notes` (too much noise, slow).
- Case-insensitive substring match.
- No diacritic normalization in v1 — "francois" does not match "François."
- No fuzzy matching, no ranking, no debounce (list size is small).
- No results state when search matches nothing.

### 9. Contact detail UI

`client/pages/contact-detail.tsx`:
- Fetches contact from `GET /api/contacts/:id` on mount.
- Displays all fields in read-only view.
- LinkedIn URL: renders as clickable link that opens in new tab.
- Phone: displays formatted for contact's `defaultCountry`.

**Phone display format:** If the phone's parsed country matches the contact's `defaultCountry` (or DEFAULT_COUNTRY env var fallback), display in national format (e.g., "(415) 555-1234"). Otherwise display in international format (e.g., "+44 20 7946 0958"). Use `libphonenumber-js`'s `format('NATIONAL')` and `format('INTERNATIONAL')` methods.

- "Edit" button navigates to `/contacts/:id/edit`.
- "Delete" button shows confirmation modal ("Delete Sarah Chen?"), then calls `DELETE /api/contacts/:id`, then navigates to list.
- 404 handling: show "Contact not found" message with link back to list.

### 10. LinkedIn URL: no-scraping rule (ADR 002 reinforced)

**The LinkedIn URL field is a stored string only.**

- No network calls to LinkedIn.
- No metadata extraction.
- No photo fetching.
- No enrichment.
- No preview cards.
- The ONLY operation is click-to-open in browser (`<a href={url} target="_blank" rel="noopener noreferrer">`).

This rule exists to prevent future sessions from "helpfully" adding scraping that would violate LinkedIn ToS. If you're reading this spec and thinking "we could auto-fetch the profile photo," stop. Re-read ADR 002.

### 11. Contact form UI

`client/pages/contact-form.tsx`:
- Used for both create (`/contacts/new`) and edit (`/contacts/:id/edit`).
- Fields: name, preferredName, linkedinUrl, phone, defaultCountry (dropdown), email, company, title, notes (textarea).
- `name` field is required. All others optional.

**Country dropdown:**
- Displays country names sorted alphabetically ("United Kingdom", "United States", etc.).
- Values are ISO 3166-1 alpha-2 codes (`GB`, `US`, etc.).
- Default selection is the value of `DEFAULT_COUNTRY` env var.

**Country dropdown source:** Enumerate countries from `libphonenumber-js`'s `getCountries()` function for the ISO 3166-1 alpha-2 codes. Resolve display names via the browser's built-in `Intl.DisplayNames` API: `new Intl.DisplayNames(['en'], { type: 'region' })`. This keeps the dropdown in sync with the phone library without adding a new dependency.

**Validation UX:**
- Submit-then-validate as default behavior.
- Phone field: validates on blur. If `libphonenumber-js` cannot parse, show inline message: "Couldn't parse as phone number."
- LinkedIn URL field: rejects URLs without protocol. Error message: "LinkedIn URL must start with https:// or http://".
- Name: reject if empty or whitespace-only after trim. Message: "Name is required."
- On validation failure, scroll to first error field.

**Form behavior:**
- Auto-focus `name` field on new-contact form open.
- Do NOT auto-focus on edit form (user may want to edit any field).
- Explicit "Save" button. No auto-save.
- No unsaved-changes warning in Sprint 04.
- On save success: navigate to detail view at `/contacts/:id`.
- On save failure: show error via ErrorBoundary or inline error message.

### 12. Soft delete confirmation

Before soft-deleting a contact:
- Show confirmation modal: "Delete {contact.name}?"
- Two buttons: "Cancel" (closes modal), "Delete" (proceeds with deletion).
- No "Trash" view in Sprint 04. Deleted contacts are hidden from list.
- Restoration requires manual JSON edit or future Trash view (add to backlog).

### 13. Quarantined contact visibility

When a Contact JSON file on disk fails Zod validation, FileStore quarantines it (existing Sprint 02 behavior). FileStore's `getAll()` catches the quarantine error, logs a warning, and continues — quarantined files are silently skipped from the list.

In Sprint 04:
- Quarantined contacts are **invisible** in the UI.
- They do not appear in the list.
- Direct navigation to `/contacts/:id` returns 404.
- Sprint 03.5's System Status view will surface quarantined files for manual repair.

No changes to quarantine behavior; this section documents the expected UX.

## Scope (explicitly out)

- `metDate` / `howWeMet` fields — Sprint 05 (Interactions).
- `tier` field — Sprint 06 (will add via schema migration).
- Trash view for soft-deleted contacts — future sprint (add to backlog).
- Schema migration for `schemaVersion < expected` — future sprint (add to backlog).
- Toast notifications for save success — Sprint 03.5.
- System Status view showing quarantined files — Sprint 03.5.
- Fuzzy search / full-text search — polish sprint.
- Diacritic-insensitive search — polish sprint (add to backlog).
- Unsaved changes warning — polish sprint.
- Contact photo — not planned (per ADR 002, no LinkedIn photo fetching).

## Directory layout (target additions)

```
server/
├── schemas/
│   └── contact.ts              (Contact Zod schema + CONTACT_SCHEMA_VERSION)
├── lib/
│   ├── phone.ts                (phone normalization with libphonenumber-js)
│   ├── phone.test.ts
│   └── file-store.ts           (small change: quarantine on schemaVersion < expected)
├── routes/
│   ├── contacts.ts             (CRUD endpoints)
│   └── contacts.test.ts
└── services/
    └── storage.ts              (construct contactsStore, expose via StorageContext)

client/
├── pages/
│   ├── contact-list.tsx
│   ├── contact-detail.tsx
│   └── contact-form.tsx
├── components/
│   ├── confirm-modal.tsx       (reusable confirmation modal)
│   └── search-input.tsx        (search box for list filtering)
├── lib/
│   └── api.ts                  (add typed contact API calls)
└── app.tsx                     (add routes)

docs/
└── data-schema.md              (update with Contact schema)
```

## Interfaces

### Contact schema
```typescript
export const CONTACT_SCHEMA_VERSION = 1;

export const ContactSchema = BaseRecordSchema.extend({
  name: z.string().min(1).max(200),
  preferredName: z.string().max(200).nullable(),
  linkedinUrl: z.string().url().max(500).nullable(),
  phone: z.string().max(50).nullable(),
  defaultCountry: z.string().length(2).nullable(),
  email: z.string().email().max(254).nullable(),
  company: z.string().max(200).nullable(),
  title: z.string().max(200).nullable(),
  notes: z.string().max(50000).nullable(),
});

export type Contact = z.infer<typeof ContactSchema>;
```

### Phone utilities
```typescript
export function normalizePhone(input: string | null | undefined, defaultCountry?: string): string | null;
export function formatPhoneForDisplay(e164: string, defaultCountry?: string): string;
```

### API responses
```typescript
// GET /api/contacts
interface ContactListResponse {
  contacts: Contact[];
}

// GET /api/contacts/:id, POST /api/contacts, PUT /api/contacts/:id
interface ContactResponse {
  contact: Contact;
}

// DELETE /api/contacts/:id
// 204 No Content (no body)
```

## Environment variables (new)

Add to `.env.example`:
```
DEFAULT_COUNTRY=US   # ISO 3166-1 alpha-2, fallback for phone parsing
```

## Dependencies to add

```json
{
  "dependencies": {
    "libphonenumber-js": "^1.11.0",
    "react-router-dom": "^6.23.0"
  }
}
```

Note: `react-router-dom` v6 includes TypeScript types; no separate `@types` package needed.

## Backlog additions from this sprint

Add to `backlog.md`:
- [ ] Schema migration strategy — define how to migrate records when `schemaVersion < expected`
- [ ] Trash view for restoring soft-deleted contacts
- [ ] Diacritic-insensitive search (e.g., "francois" matches "François")
- [ ] Revisit email validation strictness if Zod default rejects legitimate addresses (e.g., + aliases on certain TLDs)

## Acceptance criteria

See `acceptance.md`.

## Prompts to use with Claude Code this sprint

- *Session 1a:* "Read `CLAUDE.md`, then `specs/sprint-04-contacts/spec.md`. Implement the Contact schema, phone normalization utilities with tests, and update storage.ts to construct contactsStore. Update FileStore to quarantine on schemaVersion < expected. Do not implement API endpoints yet."
- *Session 1b:* "Continue Sprint 04. Implement contact API endpoints with tests. Use apiFetch and AppError patterns from Sprint 03."
- *Session 2:* "Continue Sprint 04. Add react-router-dom, implement contact list page with search, and contact detail page. These are read-only views consuming the API endpoints from Session 1b."
- *Session 3:* "Continue Sprint 04. Implement contact form (create/edit), confirmation modal for delete. Run full test suite and end-of-sprint checklist."
