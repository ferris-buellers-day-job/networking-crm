// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { processInbox, fetchInboxQueue, resolveInboxEntry, discardInboxEntry } from './inbox-api.js';
import { ApiError, NetworkError } from './api-error.js';

const originalFetch = global.fetch;

beforeEach(() => {
  vi.resetAllMocks();
});

afterEach(() => {
  global.fetch = originalFetch;
});

const ENTRY_ID = 'eeeeeeee-0000-0000-0000-000000000001';
const CONTACT_ID = 'cccccccc-0000-0000-0000-000000000001';

function makeEntry() {
  return {
    id: ENTRY_ID,
    createdAt: '2026-07-12T10:00:00.000Z',
    updatedAt: '2026-07-12T10:00:00.000Z',
    deletedAt: null,
    schemaVersion: 1,
    rawId: 'a3f7c2b1',
    rawText: '---\nid: a3f7c2b1\n---',
    status: 'pending' as const,
    matchState: 'unmatched' as const,
    parsedDate: '2026-07-12T17:30:00.000Z',
    parsedContact: 'Alice Smith',
    parsedType: 'meeting' as const,
    parsedSummary: null,
    parsedLocation: null,
    parseError: null,
    candidateContactIds: [],
    contactId: null,
    interactionId: null,
  };
}

describe('processInbox', () => {
  it('POSTs to /api/inbox/process with no body and returns ProcessResult', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ processed: 2, queued: 1 }),
    });

    const result = await processInbox();

    expect(result).toEqual({ processed: 2, queued: 1 });
    expect(global.fetch).toHaveBeenCalledWith(
      '/api/inbox/process',
      expect.objectContaining({ method: 'POST' })
    );
  });

  it('throws ApiError on non-2xx response', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
      json: () => Promise.resolve({
        error: { type: 'StorageError', message: 'Disk full', debugBlock: '--- DEBUG BLOCK ---\n{}\n--- END DEBUG BLOCK ---' },
      }),
    });

    await expect(processInbox()).rejects.toThrow(ApiError);
  });
});

describe('fetchInboxQueue', () => {
  it('GETs /api/inbox and returns entries array', async () => {
    const entry = makeEntry();
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ entries: [entry] }),
    });

    const result = await fetchInboxQueue();

    expect(result.entries).toHaveLength(1);
    expect(result.entries[0].id).toBe(ENTRY_ID);
    expect(global.fetch).toHaveBeenCalledWith('/api/inbox', undefined);
  });

  it('returns empty entries array when queue is empty', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ entries: [] }),
    });

    const result = await fetchInboxQueue();
    expect(result.entries).toHaveLength(0);
  });

  it('throws NetworkError when fetch rejects', async () => {
    global.fetch = vi.fn().mockRejectedValue(new Error('Failed to fetch'));

    await expect(fetchInboxQueue()).rejects.toThrow(NetworkError);
  });
});

describe('resolveInboxEntry', () => {
  it('PATCHes /api/inbox/:id/resolve with contactId body', async () => {
    const entry = { ...makeEntry(), status: 'resolved' as const, matchState: 'unmatched' as const, contactId: CONTACT_ID };
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ entry }),
    });

    const result = await resolveInboxEntry(ENTRY_ID, CONTACT_ID);

    expect(result.entry.contactId).toBe(CONTACT_ID);
    expect(global.fetch).toHaveBeenCalledWith(
      `/api/inbox/${ENTRY_ID}/resolve`,
      expect.objectContaining({
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ contactId: CONTACT_ID }),
      })
    );
  });

  it('throws ApiError 400 on validation failure', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 400,
      json: () => Promise.resolve({
        error: { type: 'ValidationError', message: 'Cannot resolve a parse error entry', debugBlock: '--- DEBUG BLOCK ---\n{}\n--- END DEBUG BLOCK ---' },
      }),
    });

    const err = await resolveInboxEntry(ENTRY_ID, CONTACT_ID).catch((e) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect((err as ApiError).statusCode).toBe(400);
  });

  it('throws ApiError 404 for nonexistent entry', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 404,
      json: () => Promise.resolve({
        error: { type: 'NotFound', message: 'Inbox entry not found', debugBlock: '--- DEBUG BLOCK ---\n{}\n--- END DEBUG BLOCK ---' },
      }),
    });

    const err = await resolveInboxEntry(ENTRY_ID, CONTACT_ID).catch((e) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect((err as ApiError).statusCode).toBe(404);
  });
});

describe('discardInboxEntry', () => {
  it('PATCHes /api/inbox/:id/discard with empty body', async () => {
    const entry = { ...makeEntry(), status: 'discarded' as const };
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ entry }),
    });

    const result = await discardInboxEntry(ENTRY_ID);

    expect(result.entry.status).toBe('discarded');
    expect(global.fetch).toHaveBeenCalledWith(
      `/api/inbox/${ENTRY_ID}/discard`,
      expect.objectContaining({
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      })
    );
  });

  it('throws ApiError on non-2xx response', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 400,
      json: () => Promise.resolve({
        error: { type: 'ValidationError', message: 'Entry is not pending', debugBlock: '--- DEBUG BLOCK ---\n{}\n--- END DEBUG BLOCK ---' },
      }),
    });

    await expect(discardInboxEntry(ENTRY_ID)).rejects.toThrow(ApiError);
  });
});
