# Sprint 04 — Contacts: Acceptance Criteria

## Schema and Validation

- [ ] `ContactSchema` Zod schema exists with all fields: name, preferredName, linkedinUrl, phone, defaultCountry, email, company, title, notes
- [ ] `CONTACT_SCHEMA_VERSION = 1` exported from schema module
- [ ] Name field rejects empty string and whitespace-only input
- [ ] Name field is trimmed before save
- [ ] Phone field stored in E.164 format when valid
- [ ] Phone field rejects unparseable input with clear error
- [ ] Email domain portion is lowercased on save (local part preserved)
- [ ] All optional fields accept null
- [ ] Schema enforces field length limits (name 200, notes 50000, etc.)

## Phone Normalization

- [ ] `normalizePhone()` parses international format (starts with +)
- [ ] `normalizePhone()` uses contact's defaultCountry for ambiguous numbers
- [ ] `normalizePhone()` falls back to DEFAULT_COUNTRY env var
- [ ] `normalizePhone()` returns null for unparseable input
- [ ] `normalizePhone()` handles empty string input without error (returns null)
- [ ] `normalizePhone()` handles null input without error (returns null)
- [ ] `formatPhoneForDisplay()` formats E.164 for human reading
- [ ] Phone utilities have test coverage

## Per-Entity Schema Versioning

- [ ] FileStore receives entity-specific schema version (CONTACT_SCHEMA_VERSION)
- [ ] Records with schemaVersion > expected are quarantined
- [ ] Records with schemaVersion < expected are quarantined with message "Schema migration not yet implemented (found v{N}, expected v{M})"
- [ ] Test in file-store.test.ts: FileStore with schemaVersion < expected quarantines the file with reason "Schema migration not yet implemented (found v{N}, expected v{M})"
- [ ] Global .schema-version file remains unchanged
- [ ] "Schema migration strategy" added to backlog

## Storage.ts Wiring

- [ ] `contactsStore` constructed in `initStorage()` with CONTACT_SCHEMA_VERSION
- [ ] `StorageContext` interface updated to include `contactsStore`
- [ ] contactsStore exposed in returned context object

## API Endpoints

- [ ] `GET /api/contacts` returns all non-deleted contacts
- [ ] `GET /api/contacts` returns contacts sorted by name ascending, case-insensitive
- [ ] `GET /api/contacts/:id` returns single contact
- [ ] `GET /api/contacts/:id` returns 404 for deleted or nonexistent contact
- [ ] `POST /api/contacts` creates contact with generated UUID and timestamps
- [ ] `POST /api/contacts` returns 400 for invalid input (empty name, bad phone)
- [ ] `PUT /api/contacts/:id` updates contact and sets updatedAt
- [ ] `PUT /api/contacts/:id` returns 404 for deleted or nonexistent contact
- [ ] `DELETE /api/contacts/:id` soft-deletes (sets deletedAt, not hard delete)
- [ ] `DELETE /api/contacts/:id` returns 204 on success
- [ ] All endpoints return errors in ApiErrorResponse format (Sprint 03)
- [ ] API endpoints have test coverage

## Contact List UI

- [ ] `/contacts` route displays list of all contacts
- [ ] List shows name (or preferredName), company, email
- [ ] Click on contact navigates to `/contacts/:id`
- [ ] "New Contact" button navigates to `/contacts/new`
- [ ] Loading state shown while fetching
- [ ] Empty state shown when no contacts exist
- [ ] Soft-deleted contacts do not appear in list

## Search

- [ ] Search input above contact list
- [ ] Filters as user types (no submit button needed)
- [ ] Searches name, preferredName, company, email
- [ ] Does NOT search notes field
- [ ] Case-insensitive matching
- [ ] No diacritic normalization (exact substring match)
- [ ] No results state when search matches nothing
- [ ] "Diacritic-insensitive search" added to backlog

## Contact Detail UI

- [ ] `/contacts/:id` route displays single contact
- [ ] All fields displayed in read-only view
- [ ] LinkedIn URL renders as clickable link (opens in new tab)
- [ ] Phone displayed in human-readable format
- [ ] "Edit" button navigates to `/contacts/:id/edit`
- [ ] "Delete" button shows confirmation modal
- [ ] 404 page shown for nonexistent or deleted contact

## Contact Form UI

- [ ] `/contacts/new` route shows create form
- [ ] `/contacts/:id/edit` route shows edit form with existing data
- [ ] Name field is required, others optional
- [ ] Name field auto-focuses on new form only
- [ ] Phone field shows inline error on blur if invalid ("Couldn't parse as phone number")
- [ ] LinkedIn URL field rejects URLs without https:// or http:// prefix with clear error message
- [ ] Country dropdown displays country names with ISO alpha-2 code values
- [ ] Country dropdown defaults to DEFAULT_COUNTRY env var value
- [ ] "Save" button submits form
- [ ] On create success, navigates to `/contacts/:id`
- [ ] On edit success, navigates to `/contacts/:id`
- [ ] Validation errors shown on submit failure

## Soft Delete

- [ ] Delete button shows confirmation modal with contact name
- [ ] Cancel button closes modal without action
- [ ] Confirm button soft-deletes and navigates to list
- [ ] "Trash view" added to backlog for future sprint

## LinkedIn URL Compliance (ADR 002)

- [ ] LinkedIn URL is stored as plain string
- [ ] No network calls made to LinkedIn URLs
- [ ] No metadata extraction from LinkedIn
- [ ] No photo fetching from LinkedIn
- [ ] Click opens URL in new browser tab only

## Quarantined Contacts

- [ ] Quarantined contacts do not appear in list
- [ ] Direct navigation to quarantined contact returns 404
- [ ] No new quarantine UI in this sprint (Sprint 03.5 scope)

## Documentation

- [ ] `docs/data-schema.md` updated with Contact schema
- [ ] `.env.example` updated with DEFAULT_COUNTRY
- [ ] Backlog updated with deferred items:
  - [ ] Schema migration strategy
  - [ ] Trash view for restoring soft-deleted contacts
  - [ ] Diacritic-insensitive search
  - [ ] Revisit email validation strictness

## Tests

- [ ] Phone normalization unit tests (including empty/null input handling)
- [ ] Contact schema validation tests
- [ ] Contact API endpoint integration tests
- [ ] Per-entity schema version handling tests (including schemaVersion < expected quarantine)
