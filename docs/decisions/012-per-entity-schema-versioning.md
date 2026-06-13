# ADR 012: Per-Entity Schema Versioning

**Status:** Accepted
**Date:** 2026-06-13

## Context

Sprint 02 introduced `FileStore<T>` with a single `expectedSchemaVersion` parameter passed at construction time. This assumed a single schema version across all record types. As of Sprint 04, the Contacts entity ships with `schemaVersion: 1`, and future entities (Interactions, etc.) will each start at their own version 1 and evolve independently.

## Decision

Each entity's `FileStore` instance is constructed with the schema version specific to that entity. Entity schema version constants (e.g., `CONTACT_SCHEMA_VERSION = 1`) live alongside their Zod schemas in `server/schemas/`. Migration logic, when needed, will live there too.

## Consequences

- Schema versions for different entities are decoupled: bumping Contact to v2 does not affect Interaction files.
- Each schema module owns its version constant — easy to find, grep, and reason about.
- The `FileStore` constructor API is unchanged; callers just pass different version constants.
- Future migration tooling will need to import per-entity constants rather than a single global.

## Alternatives considered

- **Single global version**: Would require all entities to migrate together, coupling unrelated changes.
- **Version embedded in filename**: Would break UUID-based file lookup and complicate atomic rename. Rejected per ADR 006.
