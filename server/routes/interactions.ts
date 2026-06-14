import { Router } from 'express';
import { z } from 'zod';
import { ValidationError } from '../lib/errors.js';
import { FileStore, FileStoreQuarantineError } from '../lib/file-store.js';
import { INTERACTION_SCHEMA_VERSION, type Interaction } from '../schemas/interaction.js';
import { type Contact } from '../schemas/contact.js';

export interface InteractionsRouterDeps {
  interactionsStore: FileStore<Interaction>;
  contactsStore: FileStore<Contact>;
}

const NOT_FOUND_RESPONSE = {
  error: { type: 'NotFound', message: 'Interaction not found' },
};

const InteractionCreateSchema = z.object({
  contactId:  z.string().uuid(),
  occurredAt: z.string().datetime(),
  type:       z.enum(['meeting', 'call', 'email', 'message', 'other']),
  summary:    z.string().max(10000).nullable().optional(),
  location:   z.string().max(200).nullable().optional(),
}).strict();

export function createInteractionsRouter(deps: InteractionsRouterDeps): Router {
  const { interactionsStore, contactsStore } = deps;
  const router = Router();

  // GET /api/interactions?contactId=:id — list non-deleted interactions, newest first
  router.get('/', async (req, res, next) => {
    try {
      const { contactId } = req.query;
      if (!contactId || typeof contactId !== 'string') {
        throw new ValidationError('contactId query parameter is required', {
          op: 'interactions.list',
        });
      }

      const all = await interactionsStore.getAll();
      const interactions = all
        .filter((i) => i.contactId === contactId)
        .sort((a, b) => b.occurredAt.localeCompare(a.occurredAt));

      res.json({ interactions });
    } catch (err) {
      next(err);
    }
  });

  // POST /api/interactions — create
  router.post('/', async (req, res, next) => {
    try {
      const parsed = InteractionCreateSchema.safeParse(req.body);
      if (!parsed.success) {
        throw new ValidationError(parsed.error.errors[0]?.message ?? 'Invalid request body', {
          op: 'interactions.create',
          context: { issues: parsed.error.errors },
        });
      }

      const input = parsed.data;

      // Validate contactId references a non-soft-deleted contact
      let contact: Contact | null;
      try {
        contact = await contactsStore.get(input.contactId);
      } catch (err) {
        if (err instanceof FileStoreQuarantineError) {
          contact = null;
        } else {
          throw err;
        }
      }
      if (contact === null || contact.deletedAt !== null) {
        throw new ValidationError('Contact not found or deleted', {
          op: 'interactions.create',
          context: { contactId: input.contactId },
        });
      }

      const now = new Date().toISOString();
      const interaction: Interaction = {
        id: crypto.randomUUID(),
        createdAt: now,
        updatedAt: now,
        deletedAt: null,
        schemaVersion: INTERACTION_SCHEMA_VERSION,
        contactId: input.contactId,
        occurredAt: input.occurredAt,
        type: input.type,
        summary: input.summary ?? null,
        location: input.location ?? null,
      };

      await interactionsStore.save(interaction, { preserveTimestamps: true });
      res.status(201).json({ interaction });
    } catch (err) {
      next(err);
    }
  });

  // DELETE /api/interactions/:id — soft-delete
  router.delete('/:id', async (req, res, next) => {
    try {
      let existing: Interaction | null;
      try {
        existing = await interactionsStore.get(req.params.id);
      } catch (err) {
        if (err instanceof FileStoreQuarantineError) {
          res.status(404).json(NOT_FOUND_RESPONSE);
          return;
        }
        throw err;
      }
      if (existing === null || existing.deletedAt !== null) {
        res.status(404).json(NOT_FOUND_RESPONSE);
        return;
      }

      const now = new Date().toISOString();
      await interactionsStore.save(
        { ...existing, deletedAt: now, updatedAt: now },
        { preserveTimestamps: true }
      );
      res.status(204).send();
    } catch (err) {
      next(err);
    }
  });

  return router;
}
