import { z } from 'zod';
import { BaseRecordSchema } from '../lib/schemas/base-record.js';

export const INBOX_ENTRY_SCHEMA_VERSION = 1;

export const InboxEntrySchema = BaseRecordSchema.extend({
  rawId:               z.string().max(16),
  rawText:             z.string().max(6000),
  status:              z.enum(['pending', 'resolved', 'discarded']),
  matchState:          z.enum(['auto_matched', 'ambiguous', 'unmatched', 'parse_error']),
  parsedDate:          z.string().datetime().nullable(),
  parsedContact:       z.string().max(200).nullable(),
  parsedType:          z.enum(['meeting', 'call', 'email', 'message', 'other']).nullable(),
  parsedSummary:       z.string().max(10000).nullable(),
  parsedLocation:      z.string().max(200).nullable(),
  parseError:          z.string().nullable(),
  candidateContactIds: z.array(z.string().uuid()),
  contactId:           z.string().uuid().nullable(),
  interactionId:       z.string().uuid().nullable(),
});

export type InboxEntry = z.infer<typeof InboxEntrySchema>;
