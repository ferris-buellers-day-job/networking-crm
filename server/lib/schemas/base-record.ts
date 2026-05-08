import { z } from 'zod';

/**
 * Base record schema for all entities in the system.
 * Per ADR 006, every record must have these fields:
 * - id: stable UUID v4
 * - createdAt: UTC ISO 8601 timestamp
 * - updatedAt: UTC ISO 8601 timestamp
 * - deletedAt: UTC ISO 8601 timestamp or null (soft delete)
 * - schemaVersion: positive integer for migrations
 */
export const BaseRecordSchema = z.object({
  id: z.string().uuid(),
  createdAt: z.string().datetime({ offset: true }),
  updatedAt: z.string().datetime({ offset: true }),
  deletedAt: z.string().datetime({ offset: true }).nullable(),
  schemaVersion: z.number().int().positive(),
});

export type BaseRecord = z.infer<typeof BaseRecordSchema>;
