import { z } from 'zod';
import { BaseRecordSchema } from '../lib/schemas/base-record.js';

/**
 * Schema version for Contact entity.
 * Passed to FileStore for per-entity schema versioning.
 * Increment when making breaking schema changes.
 */
export const CONTACT_SCHEMA_VERSION = 1;

/**
 * Contact schema extending BaseRecordSchema.
 * Per Sprint 04 spec:
 * - name: Required, trimmed before save, whitespace-only rejected
 * - preferredName: Optional, the name David actually uses
 * - linkedinUrl: Optional, stored string only (no scraping per ADR 002)
 * - phone: Optional, stored in E.164 format
 * - defaultCountry: Optional, ISO 3166-1 alpha-2 for phone parsing
 * - email: Optional, domain lowercased on save
 * - company: Optional
 * - title: Optional, job title
 * - notes: Optional, freeform text
 */
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
