import { z } from 'zod';
import { BaseRecordSchema } from '../lib/schemas/base-record.js';

export const INTERACTION_SCHEMA_VERSION = 1;

export const InteractionSchema = BaseRecordSchema.extend({
  contactId:  z.string().uuid(),
  occurredAt: z.string().datetime(),
  type:       z.enum(['meeting', 'call', 'email', 'message', 'other']),
  summary:    z.string().max(10000).nullable(),
  location:   z.string().max(200).nullable(),
  // Sprint 10: AI-generated fields (additive nullable per ADR 016; no schema version bump)
  aiSummary:  z.string().max(5000).nullable().default(null),
  followUps:  z.array(z.string().max(500)).nullable().default(null),
});

export type Interaction = z.infer<typeof InteractionSchema>;
