# Coding Conventions

## File Naming

- **TypeScript/TSX**: `kebab-case.ts`, `kebab-case.tsx`
- **Directories**: `kebab-case/`
- **Constants files**: `constants.ts` (not `CONSTANTS.ts`)
- **Test files**: `*.test.ts` alongside source

## TypeScript

- Strict mode enabled (`strict: true` in tsconfig)
- No `any` without a comment explaining why
- Prefer `interface` for object shapes, `type` for unions/intersections
- Use `readonly` for immutable properties
- Explicit return types on exported functions

```typescript
// Good
export function parseContact(raw: unknown): Contact {
  return contactSchema.parse(raw);
}

// Avoid
export function parseContact(raw: any) {
  return contactSchema.parse(raw);
}
```

## Commit Messages

Follow [Conventional Commits](https://www.conventionalcommits.org/):

```
<type>: <description>

[optional body]

[optional footer]
```

Types:
- `feat:` — new feature
- `fix:` — bug fix
- `docs:` — documentation only
- `refactor:` — code change that neither fixes nor adds
- `chore:` — maintenance (deps, config, etc.)
- `test:` — adding or updating tests

Examples:
```
feat: add contact search by name
fix: handle missing phone country code
docs: update architecture diagram
refactor: extract file watcher into module
chore: upgrade vite to 5.3
```

## Imports

Order (enforced by linter):
1. Node built-ins (`node:fs`, `node:path`)
2. External packages (`express`, `zod`)
3. Internal absolute paths (`@/lib/...`)
4. Relative paths (`./utils`)

## Error Handling

- No empty `catch` blocks
- Prefer `throw` over returning error values
- User-facing errors include debug context (see ADR 010)
- Use structured logging (JSON format) for server logs

```typescript
// Good
try {
  await writeContact(contact);
} catch (err) {
  logger.error({ op: "writeContact", contactId: contact.id, err });
  throw new AppError("Failed to save contact", { cause: err });
}

// Bad
try {
  await writeContact(contact);
} catch {
  // silently ignore
}
```

## SQL Style (for SQLite cache)

- Keywords: `UPPERCASE`
- Identifiers: `snake_case`
- Table names: plural (`contacts`, `interactions`)
- Primary keys: `id TEXT PRIMARY KEY`
- Foreign keys: `contact_id TEXT REFERENCES contacts(id)`

```sql
CREATE TABLE IF NOT EXISTS contacts (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
```

## CSS

- No frameworks until Sprint 11 (polish)
- Plain CSS or CSS modules
- Class names: `kebab-case`
- Component-scoped styles preferred

## Testing (from Sprint 02)

- Test files adjacent to source: `foo.ts` + `foo.test.ts`
- Use descriptive test names: `it("returns empty array when no contacts match")`
- Prefer integration tests for API routes; unit tests for pure functions
