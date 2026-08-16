import { z } from 'zod';
import { BaseRecordSchema } from '../lib/schemas/base-record.js';

export const REMINDER_SCHEMA_VERSION = 1;

export const ReminderSchema = BaseRecordSchema.extend({
  contactId: z.string().uuid(),
  dueAt:     z.string().datetime(),   // UTC ISO 8601 with Z suffix — server stores, never converts
  status:    z.enum(['pending', 'done']),
  note:      z.string().max(500).nullable(),
});

export type Reminder = z.infer<typeof ReminderSchema>;
