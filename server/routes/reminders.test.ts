import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import express, { type Express } from 'express';
import request from 'supertest';
import { CacheDb } from '../lib/cache-db.js';
import { createRecentWrites } from '../lib/recent-writes.js';
import { FileStore } from '../lib/file-store.js';
import { createErrorHandler } from '../middleware/error-handler.js';
import { ContactSchema, CONTACT_SCHEMA_VERSION, type Contact } from '../schemas/contact.js';
import { ReminderSchema, REMINDER_SCHEMA_VERSION, type Reminder } from '../schemas/reminder.js';
import { createRemindersRouter } from './reminders.js';
import type { Logger } from '../lib/logger.js';

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
    tier: null,
    ...overrides,
  };
}

function makeReminder(overrides: Partial<Reminder> = {}): Reminder {
  return {
    id: crypto.randomUUID(),
    createdAt: '2026-06-01T00:00:00.000Z',
    updatedAt: '2026-06-01T00:00:00.000Z',
    deletedAt: null,
    schemaVersion: REMINDER_SCHEMA_VERSION,
    contactId: crypto.randomUUID(),
    dueAt: '2026-09-01T12:00:00.000Z',
    status: 'pending',
    note: null,
    ...overrides,
  };
}

describe('reminders router', () => {
  let tempDir: string;
  let cacheDb: CacheDb;
  let contactStore: FileStore<Contact>;
  let reminderStore: FileStore<Reminder>;
  let app: Express;

  beforeEach(async () => {
    tempDir = await mkdtemp(path.join(tmpdir(), 'crm-reminders-test-'));
    await mkdir(path.join(tempDir, 'contacts'), { recursive: true });
    await mkdir(path.join(tempDir, 'reminders'), { recursive: true });
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

    reminderStore = new FileStore<Reminder>(
      path.join(tempDir, 'reminders'),
      ReminderSchema,
      { cacheDb, logger, recentWrites },
      { expectedSchemaVersion: REMINDER_SCHEMA_VERSION }
    );

    app = express();
    app.use(express.json());
    app.use('/api/reminders', createRemindersRouter({ remindersStore: reminderStore, contactsStore: contactStore }));
    app.use(createErrorHandler(logger));
  });

  afterEach(async () => {
    cacheDb.close();
    await rm(tempDir, { recursive: true, force: true });
  });

  // ---------------------------------------------------------------------------
  // POST /api/reminders
  // ---------------------------------------------------------------------------
  describe('POST /api/reminders', () => {
    it('creates a reminder with status pending and returns 201', async () => {
      const contact = makeContact();
      await contactStore.save(contact, { preserveTimestamps: true });

      const res = await request(app)
        .post('/api/reminders')
        .send({ contactId: contact.id, dueAt: '2026-09-01T12:00:00.000Z' });

      expect(res.status).toBe(201);
      expect(res.body.reminder.status).toBe('pending');
      expect(res.body.reminder.contactId).toBe(contact.id);
      expect(res.body.reminder.dueAt).toBe('2026-09-01T12:00:00.000Z');
      expect(res.body.reminder.note).toBeNull();
    });

    it('stores deletedAt as null from first write — status and deletedAt are independent', async () => {
      const contact = makeContact();
      await contactStore.save(contact, { preserveTimestamps: true });

      const res = await request(app)
        .post('/api/reminders')
        .send({ contactId: contact.id, dueAt: '2026-09-01T12:00:00.000Z' });

      expect(res.status).toBe(201);
      expect(res.body.reminder.deletedAt).toBeNull();
    });

    it('stores a note when provided', async () => {
      const contact = makeContact();
      await contactStore.save(contact, { preserveTimestamps: true });

      const res = await request(app)
        .post('/api/reminders')
        .send({ contactId: contact.id, dueAt: '2026-09-01T12:00:00.000Z', note: 'Ask about Q4' });

      expect(res.status).toBe(201);
      expect(res.body.reminder.note).toBe('Ask about Q4');
    });

    it('returns 400 if contactId references a non-existent contact', async () => {
      const res = await request(app)
        .post('/api/reminders')
        .send({ contactId: crypto.randomUUID(), dueAt: '2026-09-01T12:00:00.000Z' });

      expect(res.status).toBe(400);
      expect(res.body.error.type).toBe('ValidationError');
    });

    it('returns 400 if contactId references a soft-deleted contact', async () => {
      const contact = makeContact({ deletedAt: '2026-06-01T00:00:00.000Z' });
      await contactStore.save(contact, { preserveTimestamps: true });

      const res = await request(app)
        .post('/api/reminders')
        .send({ contactId: contact.id, dueAt: '2026-09-01T12:00:00.000Z' });

      expect(res.status).toBe(400);
    });

    it('returns 400 for extra fields (strict mode)', async () => {
      const contact = makeContact();
      await contactStore.save(contact, { preserveTimestamps: true });

      const res = await request(app)
        .post('/api/reminders')
        .send({ contactId: contact.id, dueAt: '2026-09-01T12:00:00.000Z', extra: 'bad' });

      expect(res.status).toBe(400);
    });

    // dueAt UTC boundary — local→UTC conversion is the client's responsibility;
    // the server enforces Z-suffix UTC via z.string().datetime().
    it('returns 400 if dueAt is an offset-bearing string (not UTC Z)', async () => {
      const contact = makeContact();
      await contactStore.save(contact, { preserveTimestamps: true });

      const res = await request(app)
        .post('/api/reminders')
        .send({ contactId: contact.id, dueAt: '2026-08-20T17:00:00-06:00' });

      expect(res.status).toBe(400);
    });

    it('returns 400 if dueAt is a bare local string with no zone', async () => {
      const contact = makeContact();
      await contactStore.save(contact, { preserveTimestamps: true });

      const res = await request(app)
        .post('/api/reminders')
        .send({ contactId: contact.id, dueAt: '2026-08-20T17:00:00' });

      expect(res.status).toBe(400);
    });
  });

  // ---------------------------------------------------------------------------
  // GET /api/reminders
  // ---------------------------------------------------------------------------
  describe('GET /api/reminders', () => {
    it('returns empty array when no pending reminders', async () => {
      const res = await request(app).get('/api/reminders');
      expect(res.status).toBe(200);
      expect(res.body.reminders).toEqual([]);
    });

    it('returns only pending (status:pending, deletedAt:null) reminders', async () => {
      const contact = makeContact();
      await contactStore.save(contact, { preserveTimestamps: true });

      const pending = makeReminder({ contactId: contact.id, status: 'pending' });
      const done    = makeReminder({ contactId: contact.id, status: 'done', rawId: undefined } as any);
      const deleted = makeReminder({ contactId: contact.id, deletedAt: '2026-07-01T00:00:00.000Z' });

      // makeReminder doesn't have rawId — just save the three
      await reminderStore.save(pending,  { preserveTimestamps: true });
      await reminderStore.save(makeReminder({ contactId: contact.id, status: 'done' }), { preserveTimestamps: true });
      await reminderStore.save(makeReminder({ contactId: contact.id, deletedAt: '2026-07-01T00:00:00.000Z' }), { preserveTimestamps: true });

      const res = await request(app).get('/api/reminders');
      expect(res.body.reminders).toHaveLength(1);
      expect(res.body.reminders[0].id).toBe(pending.id);
    });

    it('sorts reminders by dueAt ascending', async () => {
      const contact = makeContact();
      await contactStore.save(contact, { preserveTimestamps: true });

      const r1 = makeReminder({ contactId: contact.id, dueAt: '2026-10-01T00:00:00.000Z' });
      const r2 = makeReminder({ contactId: contact.id, dueAt: '2026-09-01T00:00:00.000Z' });
      const r3 = makeReminder({ contactId: contact.id, dueAt: '2026-11-01T00:00:00.000Z' });
      await reminderStore.save(r1, { preserveTimestamps: true });
      await reminderStore.save(r2, { preserveTimestamps: true });
      await reminderStore.save(r3, { preserveTimestamps: true });

      const res = await request(app).get('/api/reminders');
      const ids = res.body.reminders.map((r: Reminder) => r.id);
      expect(ids).toEqual([r2.id, r1.id, r3.id]);
    });

    it('does not return done reminders', async () => {
      const contact = makeContact();
      await contactStore.save(contact, { preserveTimestamps: true });
      await reminderStore.save(makeReminder({ contactId: contact.id, status: 'done' }), { preserveTimestamps: true });

      const res = await request(app).get('/api/reminders');
      expect(res.body.reminders).toHaveLength(0);
    });

    it('does not return soft-deleted reminders', async () => {
      const contact = makeContact();
      await contactStore.save(contact, { preserveTimestamps: true });
      await reminderStore.save(
        makeReminder({ contactId: contact.id, deletedAt: '2026-07-01T00:00:00.000Z' }),
        { preserveTimestamps: true }
      );

      const res = await request(app).get('/api/reminders');
      expect(res.body.reminders).toHaveLength(0);
    });
  });

  // ---------------------------------------------------------------------------
  // PATCH /api/reminders/:id/done
  // ---------------------------------------------------------------------------
  describe('PATCH /api/reminders/:id/done', () => {
    it('sets status to done and returns 200; deletedAt remains null', async () => {
      const contact = makeContact();
      await contactStore.save(contact, { preserveTimestamps: true });
      const reminder = makeReminder({ contactId: contact.id });
      await reminderStore.save(reminder, { preserveTimestamps: true });

      const res = await request(app).patch(`/api/reminders/${reminder.id}/done`).send({});

      expect(res.status).toBe(200);
      expect(res.body.reminder.status).toBe('done');
      expect(res.body.reminder.deletedAt).toBeNull();
    });

    it('returns 400 if reminder is already done', async () => {
      const contact = makeContact();
      await contactStore.save(contact, { preserveTimestamps: true });
      const reminder = makeReminder({ contactId: contact.id, status: 'done' });
      await reminderStore.save(reminder, { preserveTimestamps: true });

      const res = await request(app).patch(`/api/reminders/${reminder.id}/done`).send({});
      expect(res.status).toBe(400);
      expect(res.body.error.message).toMatch(/already done/i);
    });

    it('returns 400 if reminder has been soft-deleted', async () => {
      const contact = makeContact();
      await contactStore.save(contact, { preserveTimestamps: true });
      const reminder = makeReminder({ contactId: contact.id, deletedAt: '2026-07-01T00:00:00.000Z' });
      await reminderStore.save(reminder, { preserveTimestamps: true });

      const res = await request(app).patch(`/api/reminders/${reminder.id}/done`).send({});
      expect(res.status).toBe(400);
    });

    it('returns 404 for nonexistent reminder id', async () => {
      const res = await request(app).patch(`/api/reminders/${crypto.randomUUID()}/done`).send({});
      expect(res.status).toBe(404);
    });

    it('returns 400 for extra fields in body', async () => {
      const contact = makeContact();
      await contactStore.save(contact, { preserveTimestamps: true });
      const reminder = makeReminder({ contactId: contact.id });
      await reminderStore.save(reminder, { preserveTimestamps: true });

      const res = await request(app).patch(`/api/reminders/${reminder.id}/done`).send({ extra: 'bad' });
      expect(res.status).toBe(400);
    });
  });

  // ---------------------------------------------------------------------------
  // DELETE /api/reminders/:id
  // ---------------------------------------------------------------------------
  describe('DELETE /api/reminders/:id', () => {
    it('soft-deletes the reminder and returns 204', async () => {
      const contact = makeContact();
      await contactStore.save(contact, { preserveTimestamps: true });
      const reminder = makeReminder({ contactId: contact.id });
      await reminderStore.save(reminder, { preserveTimestamps: true });

      const res = await request(app).delete(`/api/reminders/${reminder.id}`);
      expect(res.status).toBe(204);

      const record = await reminderStore.get(reminder.id, { forceReload: true });
      expect(record?.deletedAt).not.toBeNull();
    });

    it('returns 400 if reminder is already soft-deleted', async () => {
      const contact = makeContact();
      await contactStore.save(contact, { preserveTimestamps: true });
      const reminder = makeReminder({ contactId: contact.id, deletedAt: '2026-07-01T00:00:00.000Z' });
      await reminderStore.save(reminder, { preserveTimestamps: true });

      const res = await request(app).delete(`/api/reminders/${reminder.id}`);
      expect(res.status).toBe(400);
    });

    it('returns 404 for nonexistent reminder id', async () => {
      const res = await request(app).delete(`/api/reminders/${crypto.randomUUID()}`);
      expect(res.status).toBe(404);
    });
  });
});
