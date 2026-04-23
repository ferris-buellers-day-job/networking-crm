# Data Schema

> **Note:** This document will be populated in Sprint 04 when the first entity (Contact) is implemented. Until then, it serves as a placeholder.

## Common Fields

All entities will include:

| Field | Type | Description |
|-------|------|-------------|
| `id` | UUID string | Immutable primary identifier |
| `createdAt` | ISO 8601 UTC | When the record was created |
| `updatedAt` | ISO 8601 UTC | When the record was last modified |
| `deletedAt` | ISO 8601 UTC \| null | Soft delete timestamp |
| `schemaVersion` | integer | For future migrations |

## Planned Entities

- **Contact** (Sprint 04)
- **Interaction** (Sprint 05)
- **ActionItem** (Sprint 06)

## Validation

All schemas are defined with Zod and validated on every read and write. See ADR 006 for data hygiene rules.
