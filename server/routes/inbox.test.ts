import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtemp, rm, mkdir, writeFile, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import express, { type Express } from 'express';
import request from 'supertest';
import { CacheDb } from '../lib/cache-db.js';
import { createRecentWrites } from '../lib/recent-writes.js';
import { FileStore } from '../lib/file-store.js';
import { createErrorHandler } from '../middleware/error-handler.js';
import { ContactSchema, CONTACT_SCHEMA_VERSION, type Contact } from '../schemas/contact.js';
import { InteractionSchema, INTERACTION_SCHEMA_VERSION, type Interaction } from '../schemas/interaction.js';
import { InboxEntrySchema, INBOX_ENTRY_SCHEMA_VERSION, type InboxEntry } from '../schemas/inbox-entry.js';
import { createInboxRouter } from './inbox.js';
import type { Logger } from '../lib/logger.js';

// Allow vi.spyOn on node:fs/promises for the byte-level safety test.
// Spread into a plain object so properties are configurable (importOriginal() returns
// a frozen ES module object where vi.spyOn cannot redefine exports).
vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>();
  return { ...actual };
});
import * as fsPromises from 'node:fs/promises';

function createMockLogger(): Logger {
  return { debug() {}, info() {}, warn() {}, error() {} };
}

function makeContact(overrides: Partial<Contact> = {}): Contact {
  return {
    id: crypto.randomUUID(),
    createdAt: '2026-06-01T00:00:00.000Z',
    updatedAt: '2026-06-01T00:00:00.000Z',
    deletedAt: null,
    schemaVersion: CONTACT_SCHEMA_VERSION,
    name: 'Test Contact',
    preferredName: null,
    linkedinUrl: null,
    phone: null,
    defaultCountry: null,
    email: null,
    company: null,
    title: null,
    notes: null,
    ...overrides,
  };
}

function makeInboxEntry(overrides: Partial<InboxEntry> = {}): InboxEntry {
  return {
    id: crypto.randomUUID(),
    createdAt: '2026-06-01T00:00:00.000Z',
    updatedAt: '2026-06-01T00:00:00.000Z',
    deletedAt: null,
    schemaVersion: INBOX_ENTRY_SCHEMA_VERSION,
    rawId: 'a3f7c2b1',
    rawText: '---\nid: a3f7c2b1\n---',
    status: 'pending',
    matchState: 'unmatched',
    parsedDate: '2026-06-01T10:00:00.000Z',
    parsedContact: 'Alice Smith',
    parsedType: 'meeting',
    parsedSummary: null,
    parsedLocation: null,
    parseError: null,
    candidateContactIds: [],
    contactId: null,
    interactionId: null,
    ...overrides,
  };
}

function inboxEntry(fields: Record<string, string | undefined>, summary?: string): string {
  const lines = ['---'];
  for (const [k, v] of Object.entries(fields)) {
    if (v !== undefined) lines.push(`${k}: ${v}`);
  }
  if (summary !== undefined) lines.push(`summary: ${summary}`);
  lines.push('---');
  return lines.join('\n') + '\n';
}

const VALID_DATE = '2026-06-28T15:30:00-07:00';

describe('inbox router', () => {
  let tempDir: string;
  let inboxPath: string;
  let cacheDb: CacheDb;
  let contactStore: FileStore<Contact>;
  let interactionStore: FileStore<Interaction>;
  let inboxEntryStore: FileStore<InboxEntry>;
  let app: Express;

  beforeEach(async () => {
    tempDir = await mkdtemp(path.join(tmpdir(), 'crm-inbox-test-'));
    inboxPath = path.join(tempDir, 'inbox.txt');
    await mkdir(path.join(tempDir, 'contacts'), { recursive: true });
    await mkdir(path.join(tempDir, 'interactions'), { recursive: true });
    await mkdir(path.join(tempDir, 'inbox_queue'), { recursive: true });
    await mkdir(path.join(tempDir, '.quarantine'), { recursive: true });

    const dbPath = path.join(tempDir, 'cache.db');
    cacheDb = new CacheDb(dbPath);
    cacheDb.init();

    const logger = createMockLogger();
    const recentWrites = createRecentWrites();

    contactStore = new FileStore<Contact>(
      path.join(tempDir, 'contacts'),
      ContactSchema,
      { cacheDb, logger, recentWrites },
      { expectedSchemaVersion: CONTACT_SCHEMA_VERSION }
    );

    interactionStore = new FileStore<Interaction>(
      path.join(tempDir, 'interactions'),
      InteractionSchema,
      { cacheDb, logger, recentWrites },
      { expectedSchemaVersion: INTERACTION_SCHEMA_VERSION }
    );

    inboxEntryStore = new FileStore<InboxEntry>(
      path.join(tempDir, 'inbox_queue'),
      InboxEntrySchema,
      { cacheDb, logger, recentWrites },
      { expectedSchemaVersion: INBOX_ENTRY_SCHEMA_VERSION }
    );

    app = express();
    app.use(express.json());
    app.use(
      '/api/inbox',
      createInboxRouter({
        inboxEntryStore,
        contactsStore: contactStore,
        interactionsStore: interactionStore,
        logger,
        dataPath: tempDir,
      })
    );
    app.use(createErrorHandler(logger));
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    cacheDb.close();
    await rm(tempDir, { recursive: true, force: true });
  });

  // ---------------------------------------------------------------------------
  // POST /api/inbox/process
  // ---------------------------------------------------------------------------
  describe('POST /api/inbox/process', () => {
    it('returns { processed: 0, queued: 0 } when inbox.txt is absent', async () => {
      const res = await request(app).post('/api/inbox/process');
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ processed: 0, queued: 0 });
    });

    it('returns { processed: 0, queued: 0 } when inbox.txt is empty', async () => {
      await writeFile(inboxPath, '');
      const res = await request(app).post('/api/inbox/process');
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ processed: 0, queued: 0 });
    });

    it('auto-matched entry creates Interaction and resolved InboxEntry', async () => {
      const contact = makeContact({ name: 'Alice Smith' });
      await contactStore.save(contact, { preserveTimestamps: true });
      await writeFile(inboxPath, inboxEntry({ id: 'a3f7c2b1', date: VALID_DATE, contact: 'Alice Smith', type: 'call' }));

      const res = await request(app).post('/api/inbox/process');
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ processed: 1, queued: 0 });

      const entries = await inboxEntryStore.getAll();
      expect(entries).toHaveLength(1);
      expect(entries[0].status).toBe('resolved');
      expect(entries[0].matchState).toBe('auto_matched');
      expect(entries[0].contactId).toBe(contact.id);
      expect(entries[0].interactionId).toBeTruthy();

      const interactions = await interactionStore.getAll();
      expect(interactions).toHaveLength(1);
      expect(interactions[0].contactId).toBe(contact.id);
      expect(interactions[0].type).toBe('call');
    });

    it('auto-match uses parsedDate (UTC-Z) as occurredAt', async () => {
      const contact = makeContact({ name: 'Alice Smith' });
      await contactStore.save(contact, { preserveTimestamps: true });
      await writeFile(inboxPath, inboxEntry({ id: 'a3f7c2b1', date: '2026-06-28T15:30:00-07:00', contact: 'Alice Smith' }));

      await request(app).post('/api/inbox/process');

      const interactions = await interactionStore.getAll();
      expect(interactions[0].occurredAt).toBe('2026-06-28T22:30:00.000Z');
    });

    it('auto-match is case-insensitive and normalizes whitespace', async () => {
      const contact = makeContact({ name: 'Alice Smith' });
      await contactStore.save(contact, { preserveTimestamps: true });
      await writeFile(inboxPath, inboxEntry({ id: 'a3f7c2b1', date: VALID_DATE, contact: 'alice  smith' }));

      const res = await request(app).post('/api/inbox/process');
      expect(res.body.processed).toBe(1);
    });

    it('matches against preferredName', async () => {
      const contact = makeContact({ name: 'Robert Jones', preferredName: 'Bob' });
      await contactStore.save(contact, { preserveTimestamps: true });
      await writeFile(inboxPath, inboxEntry({ id: 'a3f7c2b1', date: VALID_DATE, contact: 'Bob' }));

      const res = await request(app).post('/api/inbox/process');
      expect(res.body.processed).toBe(1);
    });

    it('ambiguous entry (2+ matches) creates pending InboxEntry with candidateContactIds', async () => {
      const c1 = makeContact({ name: 'Alice Smith' });
      const c2 = makeContact({ name: 'Alice Smith', preferredName: 'Al' });
      await contactStore.save(c1, { preserveTimestamps: true });
      await contactStore.save(c2, { preserveTimestamps: true });
      await writeFile(inboxPath, inboxEntry({ id: 'a3f7c2b1', date: VALID_DATE, contact: 'Alice Smith' }));

      const res = await request(app).post('/api/inbox/process');
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ processed: 0, queued: 1 });

      const entries = await inboxEntryStore.getAll();
      expect(entries[0].matchState).toBe('ambiguous');
      expect(entries[0].candidateContactIds).toHaveLength(2);
    });

    it('unmatched entry creates pending InboxEntry', async () => {
      await writeFile(inboxPath, inboxEntry({ id: 'a3f7c2b1', date: VALID_DATE, contact: 'Nobody Here' }));

      const res = await request(app).post('/api/inbox/process');
      expect(res.body).toEqual({ processed: 0, queued: 1 });

      const entries = await inboxEntryStore.getAll();
      expect(entries[0].matchState).toBe('unmatched');
      expect(entries[0].status).toBe('pending');
    });

    it('parse-error entry creates pending InboxEntry with matchState parse_error', async () => {
      await writeFile(inboxPath, inboxEntry({ date: VALID_DATE, contact: 'Alice' })); // missing id

      const res = await request(app).post('/api/inbox/process');
      expect(res.body).toEqual({ processed: 0, queued: 1 });

      const entries = await inboxEntryStore.getAll();
      expect(entries[0].matchState).toBe('parse_error');
      expect(entries[0].parseError).toMatch(/missing required field: id/i);
    });

    it('rawId idempotency: re-running on same inbox.txt creates no duplicate records', async () => {
      const contact = makeContact({ name: 'Alice Smith' });
      await contactStore.save(contact, { preserveTimestamps: true });
      const content = inboxEntry({ id: 'a3f7c2b1', date: VALID_DATE, contact: 'Alice Smith' });
      await writeFile(inboxPath, content);

      await request(app).post('/api/inbox/process');
      // Restore inbox.txt for re-run (it was cleared)
      await writeFile(inboxPath, content);
      const res2 = await request(app).post('/api/inbox/process');

      expect(res2.status).toBe(200);
      expect(res2.body).toEqual({ processed: 0, queued: 0 });
      expect(await inboxEntryStore.getAll()).toHaveLength(1);
      expect(await interactionStore.getAll()).toHaveLength(1);
    });

    it('skipped entries (rawId idempotency) are NOT re-appended to inbox-processed.txt', async () => {
      const contact = makeContact({ name: 'Alice Smith' });
      await contactStore.save(contact, { preserveTimestamps: true });
      const content = inboxEntry({ id: 'a3f7c2b1', date: VALID_DATE, contact: 'Alice Smith' });
      await writeFile(inboxPath, content);

      await request(app).post('/api/inbox/process');

      // Write the same entry back and process again
      await writeFile(inboxPath, content);
      await request(app).post('/api/inbox/process');

      const auditLog = await readFile(path.join(tempDir, 'inbox-processed.txt'), 'utf-8');
      const occurrences = auditLog.split('id: a3f7c2b1').length - 1;
      expect(occurrences).toBe(1); // only appended on first processing
    });

    it('after successful run, inbox.txt is cleared', async () => {
      await writeFile(inboxPath, inboxEntry({ id: 'a3f7c2b1', date: VALID_DATE, contact: 'Nobody' }));
      await request(app).post('/api/inbox/process');
      const remaining = await readFile(inboxPath, 'utf-8');
      expect(remaining).toBe('');
    });

    it('processes multiple entries in one run', async () => {
      const c1 = makeContact({ name: 'Alice Smith' });
      const c2 = makeContact({ name: 'Bob Jones' });
      await contactStore.save(c1, { preserveTimestamps: true });
      await contactStore.save(c2, { preserveTimestamps: true });

      const content =
        inboxEntry({ id: 'a3f7c2b1', date: VALID_DATE, contact: 'Alice Smith' }) +
        inboxEntry({ id: 'b4c8d2e1', date: VALID_DATE, contact: 'Bob Jones' }) +
        inboxEntry({ id: 'c5d9e3f2', date: VALID_DATE, contact: 'Nobody Here' });

      await writeFile(inboxPath, content);
      const res = await request(app).post('/api/inbox/process');
      expect(res.body).toEqual({ processed: 2, queued: 1 });
    });

    it('byte-level safety: non-ASCII tail appended during processing survives intact', async () => {
      const contact = makeContact({ name: 'Alice Smith' });
      await contactStore.save(contact, { preserveTimestamps: true });

      const initialContent = inboxEntry({ id: 'a3f7c2b1', date: VALID_DATE, contact: 'Alice Smith' });
      const initialBuf = Buffer.from(initialContent, 'utf-8');
      await writeFile(inboxPath, initialBuf);

      // Non-ASCII entry with multibyte UTF-8 chars
      const tailEntry = inboxEntry({ id: 'b4c8d2e1', date: VALID_DATE, contact: 'José García' });
      const tailBuf = Buffer.from(tailEntry, 'utf-8');

      // Spy: second readFile call to inboxPath returns initial + tail (simulates concurrent append)
      let inboxReadCount = 0;
      const originalReadFile = fsPromises.readFile;
      vi.spyOn(fsPromises, 'readFile').mockImplementation(async (p: any, opts?: any) => {
        if (String(p) === inboxPath) {
          inboxReadCount++;
          if (inboxReadCount === 2) {
            return Buffer.concat([initialBuf, tailBuf]) as any;
          }
          if (inboxReadCount === 1) {
            return initialBuf as any;
          }
        }
        return (originalReadFile as any)(p, opts);
      });

      const res = await request(app).post('/api/inbox/process');
      expect(res.status).toBe(200);

      vi.restoreAllMocks();

      // inbox.txt should now contain only the tail (the concurrent append)
      const remaining = await readFile(inboxPath);
      expect(remaining.equals(tailBuf)).toBe(true);
    });
  });

  // ---------------------------------------------------------------------------
  // GET /api/inbox
  // ---------------------------------------------------------------------------
  describe('GET /api/inbox', () => {
    it('returns empty array when no pending entries', async () => {
      const res = await request(app).get('/api/inbox');
      expect(res.status).toBe(200);
      expect(res.body.entries).toEqual([]);
    });

    it('returns only pending entries sorted by createdAt ascending', async () => {
      const e1 = makeInboxEntry({ id: crypto.randomUUID(), rawId: 'aa000001', createdAt: '2026-06-01T10:00:00.000Z', status: 'pending' });
      const e2 = makeInboxEntry({ id: crypto.randomUUID(), rawId: 'aa000002', createdAt: '2026-06-01T09:00:00.000Z', status: 'pending' });
      const e3 = makeInboxEntry({ id: crypto.randomUUID(), rawId: 'aa000003', status: 'resolved', matchState: 'auto_matched', contactId: crypto.randomUUID(), interactionId: crypto.randomUUID() });
      const e4 = makeInboxEntry({ id: crypto.randomUUID(), rawId: 'aa000004', status: 'discarded' });

      await inboxEntryStore.save(e1, { preserveTimestamps: true });
      await inboxEntryStore.save(e2, { preserveTimestamps: true });
      await inboxEntryStore.save(e3, { preserveTimestamps: true });
      await inboxEntryStore.save(e4, { preserveTimestamps: true });

      const res = await request(app).get('/api/inbox');
      expect(res.status).toBe(200);
      expect(res.body.entries).toHaveLength(2);
      expect(res.body.entries[0].rawId).toBe('aa000002'); // older first
      expect(res.body.entries[1].rawId).toBe('aa000001');
    });

    it('does not return resolved or discarded entries', async () => {
      const resolved = makeInboxEntry({ id: crypto.randomUUID(), rawId: 'rr000001', status: 'resolved', matchState: 'auto_matched', contactId: crypto.randomUUID(), interactionId: crypto.randomUUID() });
      const discarded = makeInboxEntry({ id: crypto.randomUUID(), rawId: 'dd000001', status: 'discarded' });
      await inboxEntryStore.save(resolved, { preserveTimestamps: true });
      await inboxEntryStore.save(discarded, { preserveTimestamps: true });

      const res = await request(app).get('/api/inbox');
      expect(res.body.entries).toHaveLength(0);
    });
  });

  // ---------------------------------------------------------------------------
  // PATCH /api/inbox/:id/resolve
  // ---------------------------------------------------------------------------
  describe('PATCH /api/inbox/:id/resolve', () => {
    it('creates Interaction and returns resolved InboxEntry', async () => {
      const contact = makeContact({ name: 'Alice Smith' });
      await contactStore.save(contact, { preserveTimestamps: true });

      const entry = makeInboxEntry({
        matchState: 'unmatched',
        parsedDate: '2026-06-28T22:30:00.000Z',
        parsedType: 'call',
        parsedSummary: 'A great call.',
        parsedLocation: 'Zoom',
      });
      await inboxEntryStore.save(entry, { preserveTimestamps: true });

      const res = await request(app)
        .patch(`/api/inbox/${entry.id}/resolve`)
        .send({ contactId: contact.id });

      expect(res.status).toBe(200);
      expect(res.body.entry.status).toBe('resolved');
      expect(res.body.entry.contactId).toBe(contact.id);
      expect(res.body.entry.interactionId).toBeTruthy();

      const interactions = await interactionStore.getAll();
      expect(interactions).toHaveLength(1);
      expect(interactions[0].contactId).toBe(contact.id);
      expect(interactions[0].occurredAt).toBe('2026-06-28T22:30:00.000Z');
      expect(interactions[0].type).toBe('call');
      expect(interactions[0].summary).toBe('A great call.');
      expect(interactions[0].location).toBe('Zoom');
    });

    it('contactId on Interaction comes from PATCH body, not parsedContact', async () => {
      const contactA = makeContact({ name: 'Alice Smith' });
      const contactB = makeContact({ name: 'Bob Jones' });
      await contactStore.save(contactA, { preserveTimestamps: true });
      await contactStore.save(contactB, { preserveTimestamps: true });

      const entry = makeInboxEntry({ matchState: 'unmatched', parsedContact: 'alice smith' });
      await inboxEntryStore.save(entry, { preserveTimestamps: true });

      await request(app)
        .patch(`/api/inbox/${entry.id}/resolve`)
        .send({ contactId: contactB.id }); // user chose B, not the parsed contact

      const interactions = await interactionStore.getAll();
      expect(interactions[0].contactId).toBe(contactB.id);
    });

    it('returns 400 if matchState is parse_error', async () => {
      const contact = makeContact();
      await contactStore.save(contact, { preserveTimestamps: true });
      const entry = makeInboxEntry({ matchState: 'parse_error', parseError: 'bad id' });
      await inboxEntryStore.save(entry, { preserveTimestamps: true });

      const res = await request(app)
        .patch(`/api/inbox/${entry.id}/resolve`)
        .send({ contactId: contact.id });

      expect(res.status).toBe(400);
      expect(res.body.error.message).toMatch(/parse error/i);
    });

    it('returns 400 if entry is not pending', async () => {
      const contact = makeContact();
      await contactStore.save(contact, { preserveTimestamps: true });
      const entry = makeInboxEntry({ status: 'discarded' });
      await inboxEntryStore.save(entry, { preserveTimestamps: true });

      const res = await request(app)
        .patch(`/api/inbox/${entry.id}/resolve`)
        .send({ contactId: contact.id });

      expect(res.status).toBe(400);
      expect(res.body.error.message).toMatch(/not pending/i);
    });

    it('returns 400 if contactId references deleted contact', async () => {
      const contact = makeContact({ deletedAt: '2026-06-01T00:00:00.000Z' });
      await contactStore.save(contact, { preserveTimestamps: true });
      const entry = makeInboxEntry({ matchState: 'unmatched' });
      await inboxEntryStore.save(entry, { preserveTimestamps: true });

      const res = await request(app)
        .patch(`/api/inbox/${entry.id}/resolve`)
        .send({ contactId: contact.id });

      expect(res.status).toBe(400);
      expect(res.body.error.message).toMatch(/contact not found or deleted/i);
    });

    it('returns 400 for extra fields in body (strict mode)', async () => {
      const entry = makeInboxEntry({ matchState: 'unmatched' });
      await inboxEntryStore.save(entry, { preserveTimestamps: true });

      const res = await request(app)
        .patch(`/api/inbox/${entry.id}/resolve`)
        .send({ contactId: crypto.randomUUID(), extra: 'bad' });

      expect(res.status).toBe(400);
    });

    it('returns 404 for nonexistent entry id', async () => {
      const res = await request(app)
        .patch(`/api/inbox/${crypto.randomUUID()}/resolve`)
        .send({ contactId: crypto.randomUUID() });

      expect(res.status).toBe(404);
    });
  });

  // ---------------------------------------------------------------------------
  // PATCH /api/inbox/:id/discard
  // ---------------------------------------------------------------------------
  describe('PATCH /api/inbox/:id/discard', () => {
    it('sets status to discarded and returns 200 with updated entry', async () => {
      const entry = makeInboxEntry({ matchState: 'unmatched' });
      await inboxEntryStore.save(entry, { preserveTimestamps: true });

      const res = await request(app).patch(`/api/inbox/${entry.id}/discard`).send({});
      expect(res.status).toBe(200);
      expect(res.body.entry.status).toBe('discarded');
    });

    it('accepts parse_error entries (only valid action for them)', async () => {
      const entry = makeInboxEntry({ matchState: 'parse_error', parseError: 'missing id' });
      await inboxEntryStore.save(entry, { preserveTimestamps: true });

      const res = await request(app).patch(`/api/inbox/${entry.id}/discard`).send({});
      expect(res.status).toBe(200);
      expect(res.body.entry.status).toBe('discarded');
    });

    it('accepts ambiguous entries', async () => {
      const entry = makeInboxEntry({ matchState: 'ambiguous', candidateContactIds: [crypto.randomUUID()] });
      await inboxEntryStore.save(entry, { preserveTimestamps: true });

      const res = await request(app).patch(`/api/inbox/${entry.id}/discard`).send({});
      expect(res.status).toBe(200);
    });

    it('returns 400 if entry is not pending', async () => {
      const entry = makeInboxEntry({
        status: 'resolved',
        matchState: 'auto_matched',
        contactId: crypto.randomUUID(),
        interactionId: crypto.randomUUID(),
      });
      await inboxEntryStore.save(entry, { preserveTimestamps: true });

      const res = await request(app).patch(`/api/inbox/${entry.id}/discard`).send({});
      expect(res.status).toBe(400);
      expect(res.body.error.message).toMatch(/not pending/i);
    });

    it('returns 400 for extra fields in body', async () => {
      const entry = makeInboxEntry();
      await inboxEntryStore.save(entry, { preserveTimestamps: true });

      const res = await request(app).patch(`/api/inbox/${entry.id}/discard`).send({ extra: 'bad' });
      expect(res.status).toBe(400);
    });

    it('returns 404 for nonexistent entry id', async () => {
      const res = await request(app)
        .patch(`/api/inbox/${crypto.randomUUID()}/discard`)
        .send({});
      expect(res.status).toBe(404);
    });
  });
});
