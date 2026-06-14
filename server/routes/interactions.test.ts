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
import { InteractionSchema, INTERACTION_SCHEMA_VERSION, type Interaction } from '../schemas/interaction.js';
import { createInteractionsRouter } from './interactions.js';
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
    ...overrides,
  };
}

function makeInteraction(overrides: Partial<Interaction> = {}): Interaction {
  return {
    id: crypto.randomUUID(),
    createdAt: '2026-06-01T00:00:00.000Z',
    updatedAt: '2026-06-01T00:00:00.000Z',
    deletedAt: null,
    schemaVersion: INTERACTION_SCHEMA_VERSION,
    contactId: crypto.randomUUID(),
    occurredAt: '2026-06-01T10:00:00.000Z',
    type: 'meeting',
    summary: null,
    location: null,
    ...overrides,
  };
}

describe('interactions router', () => {
  let tempDir: string;
  let contactsDir: string;
  let interactionsDir: string;
  let cacheDb: CacheDb;
  let contactStore: FileStore<Contact>;
  let interactionStore: FileStore<Interaction>;
  let app: Express;

  beforeEach(async () => {
    tempDir = await mkdtemp(path.join(tmpdir(), 'crm-interactions-test-'));
    contactsDir = path.join(tempDir, 'contacts');
    interactionsDir = path.join(tempDir, 'interactions');
    await mkdir(contactsDir, { recursive: true });
    await mkdir(interactionsDir, { recursive: true });
    await mkdir(path.join(tempDir, '.quarantine'), { recursive: true });

    const dbPath = path.join(tempDir, 'cache.db');
    cacheDb = new CacheDb(dbPath);
    cacheDb.init();

    const logger = createMockLogger();
    const recentWrites = createRecentWrites();

    contactStore = new FileStore<Contact>(
      contactsDir,
      ContactSchema,
      { cacheDb, logger, recentWrites },
      { expectedSchemaVersion: CONTACT_SCHEMA_VERSION }
    );

    interactionStore = new FileStore<Interaction>(
      interactionsDir,
      InteractionSchema,
      { cacheDb, logger, recentWrites },
      { expectedSchemaVersion: INTERACTION_SCHEMA_VERSION }
    );

    app = express();
    app.use(express.json());
    app.use(
      '/api/interactions',
      createInteractionsRouter({ interactionsStore: interactionStore, contactsStore: contactStore })
    );
    app.use(createErrorHandler(logger));
  });

  afterEach(async () => {
    cacheDb.close();
    await rm(tempDir, { recursive: true, force: true });
  });

  // ---------------------------------------------------------------------------
  // GET /api/interactions?contactId=:id
  // ---------------------------------------------------------------------------
  describe('GET /api/interactions', () => {
    it('returns empty array when no interactions exist for contact', async () => {
      const contact = makeContact();
      await contactStore.save(contact, { preserveTimestamps: true });

      const res = await request(app).get(`/api/interactions?contactId=${contact.id}`);
      expect(res.status).toBe(200);
      expect(res.body.interactions).toEqual([]);
    });

    it('returns non-deleted interactions for the contact, newest first', async () => {
      const contact = makeContact();
      await contactStore.save(contact, { preserveTimestamps: true });

      const i1 = makeInteraction({ contactId: contact.id, occurredAt: '2026-06-01T10:00:00.000Z' });
      const i2 = makeInteraction({ contactId: contact.id, occurredAt: '2026-06-03T10:00:00.000Z' });
      const i3 = makeInteraction({ contactId: contact.id, occurredAt: '2026-06-02T10:00:00.000Z' });
      await interactionStore.save(i1, { preserveTimestamps: true });
      await interactionStore.save(i2, { preserveTimestamps: true });
      await interactionStore.save(i3, { preserveTimestamps: true });

      const res = await request(app).get(`/api/interactions?contactId=${contact.id}`);
      expect(res.status).toBe(200);
      expect(res.body.interactions).toHaveLength(3);
      expect(res.body.interactions[0].id).toBe(i2.id);
      expect(res.body.interactions[1].id).toBe(i3.id);
      expect(res.body.interactions[2].id).toBe(i1.id);
    });

    it('excludes soft-deleted interactions', async () => {
      const contact = makeContact();
      await contactStore.save(contact, { preserveTimestamps: true });

      const active = makeInteraction({ contactId: contact.id });
      const deleted = makeInteraction({
        contactId: contact.id,
        deletedAt: '2026-06-01T00:00:00.000Z',
      });
      await interactionStore.save(active, { preserveTimestamps: true });
      await interactionStore.save(deleted, { preserveTimestamps: true });

      const res = await request(app).get(`/api/interactions?contactId=${contact.id}`);
      expect(res.status).toBe(200);
      expect(res.body.interactions).toHaveLength(1);
      expect(res.body.interactions[0].id).toBe(active.id);
    });

    it('excludes interactions belonging to other contacts', async () => {
      const c1 = makeContact();
      const c2 = makeContact();
      await contactStore.save(c1, { preserveTimestamps: true });
      await contactStore.save(c2, { preserveTimestamps: true });

      await interactionStore.save(makeInteraction({ contactId: c1.id }), { preserveTimestamps: true });
      await interactionStore.save(makeInteraction({ contactId: c2.id }), { preserveTimestamps: true });

      const res = await request(app).get(`/api/interactions?contactId=${c1.id}`);
      expect(res.status).toBe(200);
      expect(res.body.interactions).toHaveLength(1);
      expect(res.body.interactions[0].contactId).toBe(c1.id);
    });

    it('returns 400 when contactId is missing', async () => {
      const res = await request(app).get('/api/interactions');
      expect(res.status).toBe(400);
      expect(res.body.error.type).toBe('ValidationError');
    });

    it('returns 200 with empty array for unknown contactId (no validation of contact existence)', async () => {
      const res = await request(app).get(`/api/interactions?contactId=${crypto.randomUUID()}`);
      expect(res.status).toBe(200);
      expect(res.body.interactions).toEqual([]);
    });
  });

  // ---------------------------------------------------------------------------
  // POST /api/interactions
  // ---------------------------------------------------------------------------
  describe('POST /api/interactions', () => {
    it('creates an interaction and returns 201', async () => {
      const contact = makeContact();
      await contactStore.save(contact, { preserveTimestamps: true });

      const res = await request(app)
        .post('/api/interactions')
        .send({
          contactId: contact.id,
          occurredAt: '2026-06-01T10:00:00.000Z',
          type: 'meeting',
        });

      expect(res.status).toBe(201);
      expect(res.body.interaction.contactId).toBe(contact.id);
      expect(res.body.interaction.type).toBe('meeting');
      expect(res.body.interaction.id).toBeTruthy();
      expect(res.body.interaction.deletedAt).toBeNull();
      expect(res.body.interaction.schemaVersion).toBe(INTERACTION_SCHEMA_VERSION);
    });

    it('stores optional summary and location', async () => {
      const contact = makeContact();
      await contactStore.save(contact, { preserveTimestamps: true });

      const res = await request(app)
        .post('/api/interactions')
        .send({
          contactId: contact.id,
          occurredAt: '2026-06-01T10:00:00.000Z',
          type: 'call',
          summary: 'Discussed Q3 roadmap',
          location: 'Zoom',
        });

      expect(res.status).toBe(201);
      expect(res.body.interaction.summary).toBe('Discussed Q3 roadmap');
      expect(res.body.interaction.location).toBe('Zoom');
    });

    it('stores null for omitted optional fields', async () => {
      const contact = makeContact();
      await contactStore.save(contact, { preserveTimestamps: true });

      const res = await request(app)
        .post('/api/interactions')
        .send({ contactId: contact.id, occurredAt: '2026-06-01T10:00:00.000Z', type: 'email' });

      expect(res.status).toBe(201);
      expect(res.body.interaction.summary).toBeNull();
      expect(res.body.interaction.location).toBeNull();
    });

    it('returns 400 when contactId references a soft-deleted contact', async () => {
      const contact = makeContact({ deletedAt: '2026-06-01T00:00:00.000Z' });
      await contactStore.save(contact, { preserveTimestamps: true });

      const res = await request(app)
        .post('/api/interactions')
        .send({ contactId: contact.id, occurredAt: '2026-06-01T10:00:00.000Z', type: 'meeting' });

      expect(res.status).toBe(400);
      expect(res.body.error.type).toBe('ValidationError');
      expect(res.body.error.message).toBe('Contact not found or deleted');
    });

    it('returns 400 when contactId does not exist', async () => {
      const res = await request(app)
        .post('/api/interactions')
        .send({ contactId: crypto.randomUUID(), occurredAt: '2026-06-01T10:00:00.000Z', type: 'meeting' });

      expect(res.status).toBe(400);
      expect(res.body.error.type).toBe('ValidationError');
      expect(res.body.error.message).toBe('Contact not found or deleted');
    });

    it('returns 400 when contactId references a quarantined contact', async () => {
      const id = crypto.randomUUID();
      await writeFile(path.join(contactsDir, `${id}.json`), '{invalid json}');

      const res = await request(app)
        .post('/api/interactions')
        .send({ contactId: id, occurredAt: '2026-06-01T10:00:00.000Z', type: 'meeting' });

      expect(res.status).toBe(400);
      expect(res.body.error.type).toBe('ValidationError');
      expect(res.body.error.message).toBe('Contact not found or deleted');
    });

    it('returns 400 for missing required fields', async () => {
      const res = await request(app)
        .post('/api/interactions')
        .send({ occurredAt: '2026-06-01T10:00:00.000Z', type: 'meeting' });

      expect(res.status).toBe(400);
      expect(res.body.error.type).toBe('ValidationError');
    });

    it('returns 400 for invalid type enum', async () => {
      const contact = makeContact();
      await contactStore.save(contact, { preserveTimestamps: true });

      const res = await request(app)
        .post('/api/interactions')
        .send({ contactId: contact.id, occurredAt: '2026-06-01T10:00:00.000Z', type: 'unknown' });

      expect(res.status).toBe(400);
      expect(res.body.error.type).toBe('ValidationError');
    });

    it('returns 400 for extra fields (strict mode)', async () => {
      const contact = makeContact();
      await contactStore.save(contact, { preserveTimestamps: true });

      const res = await request(app)
        .post('/api/interactions')
        .send({
          contactId: contact.id,
          occurredAt: '2026-06-01T10:00:00.000Z',
          type: 'meeting',
          extraField: 'bad',
        });

      expect(res.status).toBe(400);
      expect(res.body.error.type).toBe('ValidationError');
    });

    it('includes op "interactions.create" in debugBlock on failure', async () => {
      const res = await request(app).post('/api/interactions').send({});
      expect(res.status).toBe(400);
      expect(res.body.error.debugBlock).toContain('"op": "interactions.create"');
    });
  });

  // ---------------------------------------------------------------------------
  // DELETE /api/interactions/:id
  // ---------------------------------------------------------------------------
  describe('DELETE /api/interactions/:id', () => {
    it('soft-deletes an interaction and returns 204', async () => {
      const contact = makeContact();
      await contactStore.save(contact, { preserveTimestamps: true });
      const interaction = makeInteraction({ contactId: contact.id });
      await interactionStore.save(interaction, { preserveTimestamps: true });

      const res = await request(app).delete(`/api/interactions/${interaction.id}`);
      expect(res.status).toBe(204);
      expect(res.body).toEqual({});
    });

    it('sets deletedAt on the record', async () => {
      const contact = makeContact();
      await contactStore.save(contact, { preserveTimestamps: true });
      const interaction = makeInteraction({ contactId: contact.id });
      await interactionStore.save(interaction, { preserveTimestamps: true });

      await request(app).delete(`/api/interactions/${interaction.id}`);

      const record = await interactionStore.get(interaction.id, { forceReload: true });
      expect(record?.deletedAt).not.toBeNull();
    });

    it('returns 404 for nonexistent id', async () => {
      const res = await request(app).delete(`/api/interactions/${crypto.randomUUID()}`);
      expect(res.status).toBe(404);
      expect(res.body.error.type).toBe('NotFound');
    });

    it('returns 404 for already-deleted interaction', async () => {
      const contact = makeContact();
      await contactStore.save(contact, { preserveTimestamps: true });
      const interaction = makeInteraction({
        contactId: contact.id,
        deletedAt: '2026-06-01T00:00:00.000Z',
      });
      await interactionStore.save(interaction, { preserveTimestamps: true });

      const res = await request(app).delete(`/api/interactions/${interaction.id}`);
      expect(res.status).toBe(404);
      expect(res.body.error.type).toBe('NotFound');
    });

    it('returns 404 for quarantined interaction', async () => {
      const id = crypto.randomUUID();
      await writeFile(path.join(interactionsDir, `${id}.json`), '{invalid json}');

      const res = await request(app).delete(`/api/interactions/${id}`);
      expect(res.status).toBe(404);
      expect(res.body.error.type).toBe('NotFound');
    });
  });
});
