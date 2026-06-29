import { Router } from 'express';
import { z } from 'zod';
import { open, readFile, appendFile, rename, unlink } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import path from 'node:path';
import { ValidationError, StorageError } from '../lib/errors.js';
import { FileStore, FileStoreQuarantineError } from '../lib/file-store.js';
import { parseInbox } from '../lib/inbox-parser.js';
import { INBOX_ENTRY_SCHEMA_VERSION, type InboxEntry } from '../schemas/inbox-entry.js';
import { INTERACTION_SCHEMA_VERSION, type Interaction } from '../schemas/interaction.js';
import { type Contact } from '../schemas/contact.js';
import type { Logger } from '../lib/logger.js';

export interface InboxRouterDeps {
  inboxEntryStore:   FileStore<InboxEntry>;
  contactsStore:     FileStore<Contact>;
  interactionsStore: FileStore<Interaction>;
  logger:            Logger;
  dataPath:          string;
}

const NOT_FOUND_RESPONSE = {
  error: { type: 'NotFound', message: 'Inbox entry not found' },
};

const ResolveBodySchema = z.object({
  contactId: z.string().uuid(),
}).strict();

const DiscardBodySchema = z.object({}).strict();

function normalizeContactName(name: string): string {
  return name.toLowerCase().trim().replace(/\s+/g, ' ');
}

export function createInboxRouter(deps: InboxRouterDeps): Router {
  const { inboxEntryStore, contactsStore, interactionsStore, logger, dataPath } = deps;
  const router = Router();

  const inboxPath     = path.join(dataPath, 'inbox.txt');
  const processedPath = path.join(dataPath, 'inbox-processed.txt');

  // POST /api/inbox/process
  router.post('/process', async (req, res, next) => {
    try {
      // Step 1: read as Buffer — byte count, not character count
      const inboxBuf = await readFile(inboxPath).catch(() => Buffer.alloc(0));
      const S = inboxBuf.length;
      if (S === 0) {
        res.json({ processed: 0, queued: 0 });
        return;
      }

      // Step 2: decode
      const content = inboxBuf.toString('utf-8');

      // Step 3: parse
      const parsedEntries = parseInbox(content);

      // Step 4: load existing records for idempotency and contact matching
      const existingEntries = await inboxEntryStore.getAll();
      const processedRawIds = new Set(existingEntries.map((e) => e.rawId));

      const allContacts = await contactsStore.getAll();

      let processed = 0;
      let queued = 0;

      for (const parsed of parsedEntries) {
        // 4a: idempotency — skip if rawId already exists (any status/matchState)
        if (processedRawIds.has(parsed.rawId)) continue;

        const now = new Date().toISOString();
        let matchState: InboxEntry['matchState'];
        let candidateContactIds: string[] = [];
        let contactId: string | null = null;
        let interactionId: string | null = null;
        let status: InboxEntry['status'] = 'pending';
        let parseErrorMsg: string | null = parsed.parseError;

        if (parsed.parseError) {
          // 4b parse error path
          matchState = 'parse_error';
          queued++;
        } else {
          // 4b contact matching (ADR 014)
          const q = normalizeContactName(parsed.parsedContact!);
          const matches = allContacts.filter((c) => {
            return (
              normalizeContactName(c.name) === q ||
              (c.preferredName !== null && normalizeContactName(c.preferredName) === q)
            );
          });

          if (matches.length === 1) {
            matchState = 'auto_matched';
            contactId = matches[0].id;
          } else if (matches.length > 1) {
            matchState = 'ambiguous';
            candidateContactIds = matches.map((m) => m.id);
            queued++;
          } else {
            matchState = 'unmatched';
            queued++;
          }

          // 4c: auto_matched — create Interaction
          if (matchState === 'auto_matched') {
            try {
              const interaction: Interaction = {
                id: crypto.randomUUID(),
                createdAt: now,
                updatedAt: now,
                deletedAt: null,
                schemaVersion: INTERACTION_SCHEMA_VERSION,
                contactId: contactId!,
                occurredAt: parsed.parsedDate!,
                type: parsed.parsedType ?? 'meeting',
                summary: parsed.parsedSummary,
                location: parsed.parsedLocation,
              };
              await interactionsStore.save(interaction, { preserveTimestamps: true });
              interactionId = interaction.id;
              status = 'resolved';
              processed++;
            } catch (err) {
              // Known imperfect mapping: storage failure downgrades to 'unmatched'
              logger.error('inbox.process', 'Failed to create interaction for auto-matched entry', {
                rawId: parsed.rawId,
                error: (err as Error).message,
              });
              matchState = 'unmatched';
              parseErrorMsg = `Storage error during interaction creation: ${(err as Error).message}`;
              contactId = null;
              status = 'pending';
              queued++;
            }
          }
        }

        // Every entry gets an InboxEntry record (uniform ledger for idempotency)
        const inboxEntry: InboxEntry = {
          id: crypto.randomUUID(),
          createdAt: now,
          updatedAt: now,
          deletedAt: null,
          schemaVersion: INBOX_ENTRY_SCHEMA_VERSION,
          rawId: parsed.rawId,
          rawText: parsed.rawText,
          status,
          matchState,
          parsedDate: parsed.parsedDate,
          parsedContact: parsed.parsedContact,
          parsedType: parsed.parsedType,
          parsedSummary: parsed.parsedSummary,
          parsedLocation: parsed.parsedLocation,
          parseError: parseErrorMsg,
          candidateContactIds,
          contactId,
          interactionId,
        };

        await inboxEntryStore.save(inboxEntry, { preserveTimestamps: true });

        // 4d: audit log — awaited but errors are caught and logged; failure doesn't abort the run
        try {
          await appendFile(processedPath, parsed.rawText + '\n');
        } catch (err) {
          logger.warn('inbox.process', 'Failed to append to inbox-processed.txt', {
            rawId: parsed.rawId,
            error: (err as Error).message,
          });
        }
      }

      // Step 5: re-read as fresh Buffer, slice [S:] bytes, write back atomically
      // Preserves content appended by iPhone after our initial read.
      // A residual micro-race between re-read and write-back remains; accepted at
      // personal scale. The rawId guard makes re-processing safe.
      const freshBuf = await readFile(inboxPath).catch(() => Buffer.alloc(0));
      const tail = freshBuf.slice(S);

      const tmpSuffix = randomBytes(4).toString('hex');
      const tmpPath = `${inboxPath}.tmp.${tmpSuffix}`;
      try {
        const handle = await open(tmpPath, 'w');
        await handle.writeFile(tail);
        await handle.datasync();
        await handle.close();
        await rename(tmpPath, inboxPath);
      } catch (err) {
        try { await unlink(tmpPath); } catch { /* ignore cleanup failure */ }
        throw new StorageError(`Failed to write back inbox.txt: ${(err as Error).message}`, {
          op: 'inbox.process',
        });
      }

      res.json({ processed, queued });
    } catch (err) {
      next(err);
    }
  });

  // GET /api/inbox — list pending entries, oldest first
  router.get('/', async (req, res, next) => {
    try {
      const all = await inboxEntryStore.getAll();
      const entries = all
        .filter((e) => e.status === 'pending')
        .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
      res.json({ entries });
    } catch (err) {
      next(err);
    }
  });

  // PATCH /api/inbox/:id/resolve — link entry to a contact, create Interaction
  router.patch('/:id/resolve', async (req, res, next) => {
    try {
      const parsed = ResolveBodySchema.safeParse(req.body);
      if (!parsed.success) {
        throw new ValidationError(
          parsed.error.errors[0]?.message ?? 'Invalid request body',
          { op: 'inbox.resolve' }
        );
      }
      const { contactId } = parsed.data;

      let entry: InboxEntry | null;
      try {
        entry = await inboxEntryStore.get(req.params.id);
      } catch (err) {
        if (err instanceof FileStoreQuarantineError) {
          res.status(404).json(NOT_FOUND_RESPONSE);
          return;
        }
        throw err;
      }
      if (entry === null || entry.deletedAt !== null) {
        res.status(404).json(NOT_FOUND_RESPONSE);
        return;
      }

      if (entry.status !== 'pending') {
        throw new ValidationError('Entry is not pending', { op: 'inbox.resolve' });
      }
      if (entry.matchState === 'parse_error') {
        throw new ValidationError(
          'Cannot resolve a parse error entry — discard it instead',
          { op: 'inbox.resolve' }
        );
      }

      // Validate contactId references a non-deleted contact
      let contact: Contact | null;
      try {
        contact = await contactsStore.get(contactId);
      } catch (err) {
        if (err instanceof FileStoreQuarantineError) {
          contact = null;
        } else {
          throw err;
        }
      }
      if (contact === null || contact.deletedAt !== null) {
        throw new ValidationError('Contact not found or deleted', {
          op: 'inbox.resolve',
          context: { contactId },
        });
      }

      // Create the Interaction from parsed fields
      const now = new Date().toISOString();
      const interaction: Interaction = {
        id: crypto.randomUUID(),
        createdAt: now,
        updatedAt: now,
        deletedAt: null,
        schemaVersion: INTERACTION_SCHEMA_VERSION,
        contactId,                                   // from PATCH body, NOT parsedContact
        occurredAt: entry.parsedDate!,
        type: entry.parsedType ?? 'meeting',
        summary: entry.parsedSummary,
        location: entry.parsedLocation,
      };
      await interactionsStore.save(interaction, { preserveTimestamps: true });

      const updated: InboxEntry = {
        ...entry,
        status: 'resolved',
        contactId,
        interactionId: interaction.id,
        updatedAt: now,
      };
      await inboxEntryStore.save(updated, { preserveTimestamps: true });

      res.json({ entry: updated });
    } catch (err) {
      next(err);
    }
  });

  // PATCH /api/inbox/:id/discard — discard a pending entry (any matchState)
  router.patch('/:id/discard', async (req, res, next) => {
    try {
      const parsed = DiscardBodySchema.safeParse(req.body);
      if (!parsed.success) {
        throw new ValidationError(
          parsed.error.errors[0]?.message ?? 'Invalid request body',
          { op: 'inbox.discard' }
        );
      }

      let entry: InboxEntry | null;
      try {
        entry = await inboxEntryStore.get(req.params.id);
      } catch (err) {
        if (err instanceof FileStoreQuarantineError) {
          res.status(404).json(NOT_FOUND_RESPONSE);
          return;
        }
        throw err;
      }
      if (entry === null || entry.deletedAt !== null) {
        res.status(404).json(NOT_FOUND_RESPONSE);
        return;
      }

      if (entry.status !== 'pending') {
        throw new ValidationError('Entry is not pending', { op: 'inbox.discard' });
      }

      const now = new Date().toISOString();
      const updated: InboxEntry = { ...entry, status: 'discarded', updatedAt: now };
      await inboxEntryStore.save(updated, { preserveTimestamps: true });

      res.json({ entry: updated });
    } catch (err) {
      next(err);
    }
  });

  return router;
}
