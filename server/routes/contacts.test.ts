import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import express, { type Express } from 'express';
import request from 'supertest';
import { CacheDb } from '../lib/cache-db.js';
import { createRecentWrites } from '../lib/recent-writes.js';
import { FileStore } from '../lib/file-store.js';
import { createErrorHandler } from '../middleware/error-handler.js';
import { ContactSchema, CONTACT_SCHEMA_VERSION, type Contact } from '../schemas/contact.js';
import { createContactsRouter } from './contacts.js';
import type { Logger } from '../lib/logger.js';

function createMockLogger(): Logger {
  return {
    debug() {},
    info() {},
    warn() {},
    error() {},
  };
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

describe('contacts router', () => {
  let tempDir: string;
  let contactsDir: string;
  let cacheDb: CacheDb;
  let store: FileStore<Contact>;
  let app: Express;

  beforeEach(async () => {
    tempDir = await mkdtemp(path.join(tmpdir(), 'crm-contacts-test-'));
    contactsDir = path.join(tempDir, 'contacts');
    await mkdir(contactsDir, { recursive: true });
    await mkdir(path.join(tempDir, '.quarantine'), { recursive: true });

    const dbPath = path.join(tempDir, 'cache.db');
    cacheDb = new CacheDb(dbPath);
    cacheDb.init();

    const logger = createMockLogger();
    const recentWrites = createRecentWrites();

    store = new FileStore<Contact>(
      contactsDir,
      ContactSchema,
      { cacheDb, logger, recentWrites },
      { expectedSchemaVersion: CONTACT_SCHEMA_VERSION }
    );

    app = express();
    app.use(express.json());
    app.use('/api/contacts', createContactsRouter({ contactsStore: store }));
    app.use(createErrorHandler(logger));
  });

  afterEach(async () => {
    cacheDb.close();
    await rm(tempDir, { recursive: true, force: true });
  });

  // ---------------------------------------------------------------------------
  // GET /api/contacts
  // ---------------------------------------------------------------------------
  describe('GET /api/contacts', () => {
    it('returns empty array when no contacts exist', async () => {
      const res = await request(app).get('/api/contacts');
      expect(res.status).toBe(200);
      expect(res.body.contacts).toEqual([]);
    });

    it('returns non-deleted contacts', async () => {
      const contact = makeContact({ name: 'Alice' });
      await store.save(contact, { preserveTimestamps: true });

      const res = await request(app).get('/api/contacts');
      expect(res.status).toBe(200);
      expect(res.body.contacts).toHaveLength(1);
      expect(res.body.contacts[0].id).toBe(contact.id);
    });

    it('excludes soft-deleted contacts', async () => {
      const active = makeContact({ name: 'Active' });
      const deleted = makeContact({ name: 'Deleted', deletedAt: '2026-06-01T00:00:00.000Z' });
      await store.save(active, { preserveTimestamps: true });
      await store.save(deleted, { preserveTimestamps: true });

      const res = await request(app).get('/api/contacts');
      expect(res.status).toBe(200);
      expect(res.body.contacts).toHaveLength(1);
      expect(res.body.contacts[0].id).toBe(active.id);
    });

    it('sorts contacts by name ascending case-insensitive', async () => {
      await store.save(makeContact({ name: 'Charlie' }), { preserveTimestamps: true });
      await store.save(makeContact({ name: 'alice' }), { preserveTimestamps: true });
      await store.save(makeContact({ name: 'Bob' }), { preserveTimestamps: true });

      const res = await request(app).get('/api/contacts');
      expect(res.status).toBe(200);
      const names = res.body.contacts.map((c: Contact) => c.name);
      expect(names).toEqual(['alice', 'Bob', 'Charlie']);
    });
  });

  // ---------------------------------------------------------------------------
  // GET /api/contacts/:id
  // ---------------------------------------------------------------------------
  describe('GET /api/contacts/:id', () => {
    it('returns a contact by id', async () => {
      const contact = makeContact({ name: 'Alice' });
      await store.save(contact, { preserveTimestamps: true });

      const res = await request(app).get(`/api/contacts/${contact.id}`);
      expect(res.status).toBe(200);
      expect(res.body.contact.id).toBe(contact.id);
      expect(res.body.contact.name).toBe('Alice');
    });

    it('returns 404 for nonexistent id', async () => {
      const res = await request(app).get(`/api/contacts/${crypto.randomUUID()}`);
      expect(res.status).toBe(404);
      expect(res.body.error.type).toBe('NotFound');
    });

    it('returns 404 for soft-deleted contact', async () => {
      const contact = makeContact({ deletedAt: '2026-06-01T00:00:00.000Z' });
      await store.save(contact, { preserveTimestamps: true });

      const res = await request(app).get(`/api/contacts/${contact.id}`);
      expect(res.status).toBe(404);
      expect(res.body.error.type).toBe('NotFound');
    });

    it('returns 404 for quarantined contact', async () => {
      const id = crypto.randomUUID();
      await writeFile(path.join(contactsDir, `${id}.json`), '{invalid json}');

      const res = await request(app).get(`/api/contacts/${id}`);
      expect(res.status).toBe(404);
      expect(res.body.error.type).toBe('NotFound');
    });
  });

  // ---------------------------------------------------------------------------
  // POST /api/contacts
  // ---------------------------------------------------------------------------
  describe('POST /api/contacts', () => {
    it('creates a contact and returns 201', async () => {
      const res = await request(app)
        .post('/api/contacts')
        .send({ name: 'Alice Smith' });

      expect(res.status).toBe(201);
      expect(res.body.contact.name).toBe('Alice Smith');
      expect(res.body.contact.id).toBeTruthy();
      expect(res.body.contact.createdAt).toBeTruthy();
      expect(res.body.contact.deletedAt).toBeNull();
      expect(res.body.contact.schemaVersion).toBe(CONTACT_SCHEMA_VERSION);
    });

    it('trims whitespace from name', async () => {
      const res = await request(app)
        .post('/api/contacts')
        .send({ name: '  Alice  ' });

      expect(res.status).toBe(201);
      expect(res.body.contact.name).toBe('Alice');
    });

    it('normalizes phone to E.164', async () => {
      const res = await request(app)
        .post('/api/contacts')
        .send({ name: 'Bob', phone: '(415) 555-1234', defaultCountry: 'US' });

      expect(res.status).toBe(201);
      expect(res.body.contact.phone).toBe('+14155551234');
    });

    it('stores null phone when phone is null', async () => {
      const res = await request(app)
        .post('/api/contacts')
        .send({ name: 'Bob', phone: null });

      expect(res.status).toBe(201);
      expect(res.body.contact.phone).toBeNull();
    });

    it('stores null phone when phone is empty string', async () => {
      const res = await request(app)
        .post('/api/contacts')
        .send({ name: 'Bob', phone: '' });

      expect(res.status).toBe(201);
      expect(res.body.contact.phone).toBeNull();
    });

    it('lowercases email domain, preserving local part', async () => {
      const res = await request(app)
        .post('/api/contacts')
        .send({ name: 'Greg', email: 'Greg.Smith@EXAMPLE.com' });

      expect(res.status).toBe(201);
      expect(res.body.contact.email).toBe('Greg.Smith@example.com');
    });

    it('returns 400 for empty name', async () => {
      const res = await request(app)
        .post('/api/contacts')
        .send({ name: '' });

      expect(res.status).toBe(400);
      expect(res.body.error.type).toBe('ValidationError');
    });

    it('returns 400 for whitespace-only name', async () => {
      const res = await request(app)
        .post('/api/contacts')
        .send({ name: '   ' });

      expect(res.status).toBe(400);
      expect(res.body.error.type).toBe('ValidationError');
    });

    it('returns 400 for unparseable phone', async () => {
      const res = await request(app)
        .post('/api/contacts')
        .send({ name: 'Bob', phone: 'not-a-phone', defaultCountry: 'US' });

      expect(res.status).toBe(400);
      expect(res.body.error.type).toBe('ValidationError');
      expect(res.body.error.message).toBe("Couldn't parse as phone number");
    });

    it('returns 400 for extra fields (strict mode)', async () => {
      const res = await request(app)
        .post('/api/contacts')
        .send({ name: 'Alice', id: 'injected-id' });

      expect(res.status).toBe(400);
      expect(res.body.error.type).toBe('ValidationError');
    });

    it('includes op "contacts.create" in debugBlock on failure', async () => {
      const res = await request(app)
        .post('/api/contacts')
        .send({ name: '' });

      expect(res.status).toBe(400);
      expect(res.body.error.debugBlock).toContain('"op": "contacts.create"');
    });
  });

  // ---------------------------------------------------------------------------
  // PUT /api/contacts/:id
  // ---------------------------------------------------------------------------
  describe('PUT /api/contacts/:id', () => {
    it('updates specified fields and returns updated contact', async () => {
      const contact = makeContact({ name: 'Alice', company: 'Acme' });
      await store.save(contact, { preserveTimestamps: true });

      const res = await request(app)
        .put(`/api/contacts/${contact.id}`)
        .send({ company: 'NewCo' });

      expect(res.status).toBe(200);
      expect(res.body.contact.company).toBe('NewCo');
      expect(res.body.contact.name).toBe('Alice');
    });

    it('leaves unmentioned fields unchanged (partial update)', async () => {
      const contact = makeContact({ name: 'Alice', company: 'Acme', title: 'Engineer' });
      await store.save(contact, { preserveTimestamps: true });

      const res = await request(app)
        .put(`/api/contacts/${contact.id}`)
        .send({ notes: 'Met at conference' });

      expect(res.status).toBe(200);
      expect(res.body.contact.notes).toBe('Met at conference');
      expect(res.body.contact.company).toBe('Acme');
      expect(res.body.contact.title).toBe('Engineer');
      expect(res.body.contact.name).toBe('Alice');
    });

    it('clears a nullable field when null is sent explicitly', async () => {
      const contact = makeContact({ name: 'Alice', company: 'Acme' });
      await store.save(contact, { preserveTimestamps: true });

      const res = await request(app)
        .put(`/api/contacts/${contact.id}`)
        .send({ company: null });

      expect(res.status).toBe(200);
      expect(res.body.contact.company).toBeNull();
    });

    it('normalizes phone on update', async () => {
      const contact = makeContact({ name: 'Alice' });
      await store.save(contact, { preserveTimestamps: true });

      const res = await request(app)
        .put(`/api/contacts/${contact.id}`)
        .send({ phone: '(415) 555-1234', defaultCountry: 'US' });

      expect(res.status).toBe(200);
      expect(res.body.contact.phone).toBe('+14155551234');
    });

    it('returns 400 for extra fields (strict mode)', async () => {
      const contact = makeContact({ name: 'Alice' });
      await store.save(contact, { preserveTimestamps: true });

      const res = await request(app)
        .put(`/api/contacts/${contact.id}`)
        .send({ name: 'Alice', createdAt: '2020-01-01T00:00:00.000Z' });

      expect(res.status).toBe(400);
      expect(res.body.error.type).toBe('ValidationError');
    });

    it('returns 404 for nonexistent id', async () => {
      const res = await request(app)
        .put(`/api/contacts/${crypto.randomUUID()}`)
        .send({ name: 'Alice' });

      expect(res.status).toBe(404);
      expect(res.body.error.type).toBe('NotFound');
    });

    it('returns 404 for soft-deleted contact', async () => {
      const contact = makeContact({ deletedAt: '2026-06-01T00:00:00.000Z' });
      await store.save(contact, { preserveTimestamps: true });

      const res = await request(app)
        .put(`/api/contacts/${contact.id}`)
        .send({ name: 'Alice' });

      expect(res.status).toBe(404);
      expect(res.body.error.type).toBe('NotFound');
    });

    it('returns 404 for quarantined contact', async () => {
      const id = crypto.randomUUID();
      await writeFile(path.join(contactsDir, `${id}.json`), '{invalid json}');

      const res = await request(app)
        .put(`/api/contacts/${id}`)
        .send({ name: 'Alice' });

      expect(res.status).toBe(404);
      expect(res.body.error.type).toBe('NotFound');
    });
  });

  // ---------------------------------------------------------------------------
  // DELETE /api/contacts/:id
  // ---------------------------------------------------------------------------
  describe('DELETE /api/contacts/:id', () => {
    it('soft-deletes a contact and returns 204', async () => {
      const contact = makeContact({ name: 'Alice' });
      await store.save(contact, { preserveTimestamps: true });

      const res = await request(app).delete(`/api/contacts/${contact.id}`);
      expect(res.status).toBe(204);
      expect(res.body).toEqual({});

      // Verify it's gone from the list
      const listRes = await request(app).get('/api/contacts');
      expect(listRes.body.contacts).toHaveLength(0);
    });

    it('sets deletedAt on the record', async () => {
      const contact = makeContact({ name: 'Alice' });
      await store.save(contact, { preserveTimestamps: true });

      await request(app).delete(`/api/contacts/${contact.id}`);

      const record = await store.get(contact.id, { forceReload: true });
      expect(record?.deletedAt).not.toBeNull();
    });

    it('returns 404 for nonexistent id', async () => {
      const res = await request(app).delete(`/api/contacts/${crypto.randomUUID()}`);
      expect(res.status).toBe(404);
      expect(res.body.error.type).toBe('NotFound');
    });

    it('returns 404 for already-deleted contact', async () => {
      const contact = makeContact({ deletedAt: '2026-06-01T00:00:00.000Z' });
      await store.save(contact, { preserveTimestamps: true });

      const res = await request(app).delete(`/api/contacts/${contact.id}`);
      expect(res.status).toBe(404);
      expect(res.body.error.type).toBe('NotFound');
    });

    it('returns 404 for quarantined contact', async () => {
      const id = crypto.randomUUID();
      await writeFile(path.join(contactsDir, `${id}.json`), '{invalid json}');

      const res = await request(app).delete(`/api/contacts/${id}`);
      expect(res.status).toBe(404);
      expect(res.body.error.type).toBe('NotFound');
    });
  });
});
