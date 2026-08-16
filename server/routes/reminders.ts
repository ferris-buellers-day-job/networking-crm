import { Router } from 'express';
import { z } from 'zod';
import { ValidationError } from '../lib/errors.js';
import { FileStore, FileStoreQuarantineError } from '../lib/file-store.js';
import { ReminderSchema, REMINDER_SCHEMA_VERSION, type Reminder } from '../schemas/reminder.js';
import { type Contact } from '../schemas/contact.js';

export interface RemindersRouterDeps {
  remindersStore: FileStore<Reminder>;
  contactsStore:  FileStore<Contact>;
}

const NOT_FOUND_RESPONSE = {
  error: { type: 'NotFound', message: 'Reminder not found' },
};

// POST body — dueAt must be a UTC ISO 8601 datetime (Z suffix).
// z.string().datetime() enforces this: offset-bearing strings and bare local strings are rejected.
// Local→UTC conversion is the client's responsibility; the server stores what it receives.
const CreateReminderSchema = z.object({
  contactId: z.string().uuid(),
  dueAt:     z.string().datetime(),
  note:      z.string().max(500).nullable().optional(),
}).strict();

const DoneBodySchema = z.object({}).strict();
const DeleteBodySchema = z.object({}).strict();

export function createRemindersRouter(deps: RemindersRouterDeps): Router {
  const { remindersStore, contactsStore } = deps;
  const router = Router();

  // POST /api/reminders — create a reminder
  router.post('/', async (req, res, next) => {
    try {
      const parsed = CreateReminderSchema.safeParse(req.body);
      if (!parsed.success) {
        throw new ValidationError(
          parsed.error.errors[0]?.message ?? 'Invalid request body',
          { op: 'reminders.create', context: { issues: parsed.error.errors } }
        );
      }
      const { contactId, dueAt, note } = parsed.data;

      // Validate contactId references a non-deleted, non-quarantined contact (ADR 006 §10)
      let contact: Contact | null;
      try {
        contact = await contactsStore.get(contactId);
      } catch (err) {
        if (err instanceof FileStoreQuarantineError) contact = null;
        else throw err;
      }
      if (contact === null || contact.deletedAt !== null) {
        throw new ValidationError('Contact not found or deleted', {
          op: 'reminders.create',
          context: { contactId },
        });
      }

      const now = new Date().toISOString();
      const reminder: Reminder = {
        id:            crypto.randomUUID(),
        createdAt:     now,
        updatedAt:     now,
        deletedAt:     null,
        schemaVersion: REMINDER_SCHEMA_VERSION,
        contactId,
        dueAt,
        status:        'pending',
        note:          note ?? null,
      };

      await remindersStore.save(reminder, { preserveTimestamps: true });
      res.status(201).json({ reminder });
    } catch (err) {
      next(err);
    }
  });

  // GET /api/reminders — list pending reminders, soonest first
  router.get('/', async (_req, res, next) => {
    try {
      const all = await remindersStore.getAll();
      const pending = all
        .filter((r) => r.status === 'pending' && r.deletedAt === null)
        .sort((a, b) => new Date(a.dueAt).getTime() - new Date(b.dueAt).getTime());
      res.json({ reminders: pending });
    } catch (err) {
      next(err);
    }
  });

  // PATCH /api/reminders/:id/done — mark done; leaves deletedAt: null
  router.patch('/:id/done', async (req, res, next) => {
    try {
      const parsed = DoneBodySchema.safeParse(req.body);
      if (!parsed.success) {
        throw new ValidationError(
          parsed.error.errors[0]?.message ?? 'Invalid request body',
          { op: 'reminders.done' }
        );
      }

      let reminder: Reminder | null;
      try {
        reminder = await remindersStore.get(req.params.id);
      } catch (err) {
        if (err instanceof FileStoreQuarantineError) {
          res.status(404).json(NOT_FOUND_RESPONSE);
          return;
        }
        throw err;
      }
      if (reminder === null) {
        res.status(404).json(NOT_FOUND_RESPONSE);
        return;
      }
      if (reminder.deletedAt !== null) {
        throw new ValidationError('Reminder has been deleted', { op: 'reminders.done' });
      }
      if (reminder.status === 'done') {
        throw new ValidationError('Reminder is already done', { op: 'reminders.done' });
      }

      const updated: Reminder = {
        ...reminder,
        status:    'done',
        // deletedAt intentionally left as-is (null) — status and deletedAt are orthogonal
        updatedAt: new Date().toISOString(),
      };
      await remindersStore.save(updated, { preserveTimestamps: true });
      res.json({ reminder: updated });
    } catch (err) {
      next(err);
    }
  });

  // DELETE /api/reminders/:id — direct soft-delete (user initiated)
  router.delete('/:id', async (req, res, next) => {
    try {
      let reminder: Reminder | null;
      try {
        reminder = await remindersStore.get(req.params.id);
      } catch (err) {
        if (err instanceof FileStoreQuarantineError) {
          res.status(404).json(NOT_FOUND_RESPONSE);
          return;
        }
        throw err;
      }
      if (reminder === null) {
        res.status(404).json(NOT_FOUND_RESPONSE);
        return;
      }
      if (reminder.deletedAt !== null) {
        throw new ValidationError('Reminder is already deleted', { op: 'reminders.delete' });
      }

      const now = new Date().toISOString();
      await remindersStore.save(
        { ...reminder, deletedAt: now, updatedAt: now },
        { preserveTimestamps: true }
      );
      res.status(204).send();
    } catch (err) {
      next(err);
    }
  });

  return router;
}
