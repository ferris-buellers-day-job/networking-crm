import { Router } from 'express';
import { z } from 'zod';
import { ValidationError } from '../lib/errors.js';
import { normalizePhone } from '../lib/phone.js';
import { FileStore, FileStoreQuarantineError } from '../lib/file-store.js';
import { ContactSchema, CONTACT_SCHEMA_VERSION, type Contact } from '../schemas/contact.js';

export interface ContactsRouterDeps {
  contactsStore: FileStore<Contact>;
}

const NOT_FOUND_RESPONSE = {
  error: { type: 'NotFound', message: 'Contact not found' },
};

// Base object of user-settable fields, used to derive both create and update schemas.
const UserSettableFields = z.object({
  name: z.string().trim().min(1, 'Name is required'),
  preferredName: z.string().max(200).nullable().optional(),
  linkedinUrl: z.string().url().max(500).nullable().optional(),
  phone: z.string().max(50).nullable().optional(),
  defaultCountry: z.string().length(2).nullable().optional(),
  email: z.string().email().max(254).nullable().optional(),
  company: z.string().max(200).nullable().optional(),
  title: z.string().max(200).nullable().optional(),
  notes: z.string().max(50000).nullable().optional(),
});

// .strict() rejects id, createdAt, updatedAt, deletedAt, schemaVersion, and any unknown field.
const ContactCreateSchema = UserSettableFields.strict();
const ContactUpdateSchema = UserSettableFields.partial().strict();

function normalizeEmail(email: string | null | undefined): string | null {
  if (!email) return null;
  const atIdx = email.lastIndexOf('@');
  if (atIdx === -1) return email;
  return email.slice(0, atIdx) + '@' + email.slice(atIdx + 1).toLowerCase();
}

function resolvePhone(
  phone: string | null | undefined,
  defaultCountry: string | null | undefined,
  op: string
): string | null {
  if (phone === null || phone === undefined || phone.trim() === '') return null;
  const normalized = normalizePhone(phone, defaultCountry ?? undefined);
  if (normalized === null) {
    throw new ValidationError("Couldn't parse as phone number", {
      op,
      context: { field: 'phone', value: phone },
    });
  }
  return normalized;
}

export function createContactsRouter(deps: ContactsRouterDeps): Router {
  const { contactsStore } = deps;
  const router = Router();

  // GET /api/contacts — non-deleted contacts, sorted by name ascending case-insensitive
  router.get('/', async (_req, res, next) => {
    try {
      const contacts = await contactsStore.getAll();
      contacts.sort((a, b) =>
        a.name.localeCompare(b.name, undefined, { sensitivity: 'base' })
      );
      res.json({ contacts });
    } catch (err) {
      next(err);
    }
  });

  // GET /api/contacts/:id — single contact, 404 for deleted/missing/quarantined
  router.get('/:id', async (req, res, next) => {
    try {
      let contact: Contact | null;
      try {
        contact = await contactsStore.get(req.params.id);
      } catch (err) {
        if (err instanceof FileStoreQuarantineError) {
          res.status(404).json(NOT_FOUND_RESPONSE);
          return;
        }
        throw err;
      }
      if (contact === null || contact.deletedAt !== null) {
        res.status(404).json(NOT_FOUND_RESPONSE);
        return;
      }
      res.json({ contact });
    } catch (err) {
      next(err);
    }
  });

  // POST /api/contacts — create
  router.post('/', async (req, res, next) => {
    try {
      const parsed = ContactCreateSchema.safeParse(req.body);
      if (!parsed.success) {
        throw new ValidationError(parsed.error.errors[0]?.message ?? 'Invalid request body', {
          op: 'contacts.create',
          context: { issues: parsed.error.errors },
        });
      }

      const input = parsed.data;
      const phone = resolvePhone(input.phone, input.defaultCountry, 'contacts.create');
      const email = normalizeEmail(input.email);
      const now = new Date().toISOString();

      const contact: Contact = {
        id: crypto.randomUUID(),
        createdAt: now,
        updatedAt: now,
        deletedAt: null,
        schemaVersion: CONTACT_SCHEMA_VERSION,
        name: input.name,
        preferredName: input.preferredName ?? null,
        linkedinUrl: input.linkedinUrl ?? null,
        phone,
        defaultCountry: input.defaultCountry ?? null,
        email,
        company: input.company ?? null,
        title: input.title ?? null,
        notes: input.notes ?? null,
      };

      await contactsStore.save(contact, { preserveTimestamps: true });
      res.status(201).json({ contact });
    } catch (err) {
      next(err);
    }
  });

  // PUT /api/contacts/:id — partial update, 404 for deleted/missing/quarantined
  router.put('/:id', async (req, res, next) => {
    try {
      const parsed = ContactUpdateSchema.safeParse(req.body);
      if (!parsed.success) {
        throw new ValidationError(parsed.error.errors[0]?.message ?? 'Invalid request body', {
          op: 'contacts.update',
          context: { issues: parsed.error.errors },
        });
      }

      let existing: Contact | null;
      try {
        existing = await contactsStore.get(req.params.id);
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

      const input = parsed.data;

      // For phone normalization, use the incoming defaultCountry if present, else existing.
      const effectiveCountry =
        'defaultCountry' in input ? (input.defaultCountry ?? null) : existing.defaultCountry;
      const phone = 'phone' in input
        ? resolvePhone(input.phone, effectiveCountry, 'contacts.update')
        : existing.phone;
      const email = 'email' in input ? normalizeEmail(input.email) : existing.email;

      const updated: Contact = {
        id: existing.id,
        createdAt: existing.createdAt,
        updatedAt: new Date().toISOString(),
        deletedAt: existing.deletedAt,
        schemaVersion: existing.schemaVersion,
        name: 'name' in input && input.name !== undefined ? input.name : existing.name,
        preferredName: 'preferredName' in input ? (input.preferredName ?? null) : existing.preferredName,
        linkedinUrl: 'linkedinUrl' in input ? (input.linkedinUrl ?? null) : existing.linkedinUrl,
        phone,
        defaultCountry: 'defaultCountry' in input ? (input.defaultCountry ?? null) : existing.defaultCountry,
        email,
        company: 'company' in input ? (input.company ?? null) : existing.company,
        title: 'title' in input ? (input.title ?? null) : existing.title,
        notes: 'notes' in input ? (input.notes ?? null) : existing.notes,
      };

      await contactsStore.save(updated, { preserveTimestamps: true });
      res.json({ contact: updated });
    } catch (err) {
      next(err);
    }
  });

  // DELETE /api/contacts/:id — soft delete, 404 for already-deleted/missing/quarantined
  router.delete('/:id', async (req, res, next) => {
    try {
      let existing: Contact | null;
      try {
        existing = await contactsStore.get(req.params.id);
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
      const deleted: Contact = {
        ...existing,
        deletedAt: now,
        updatedAt: now,
      };

      await contactsStore.save(deleted, { preserveTimestamps: true });
      res.status(204).send();
    } catch (err) {
      next(err);
    }
  });

  return router;
}
