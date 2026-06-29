// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { fetchInteractions, createInteraction, deleteInteraction } from './interactions-api.js';
import { ApiError, NetworkError } from './api-error.js';

const originalFetch = global.fetch;

beforeEach(() => {
  vi.resetAllMocks();
});

afterEach(() => {
  global.fetch = originalFetch;
});

const CONTACT_ID = 'cccccccc-0000-0000-0000-000000000001';
const INTERACTION_ID = 'iiiiiiii-0000-0000-0000-000000000001';

function makeInteraction() {
  return {
    id: INTERACTION_ID,
    createdAt: '2026-06-28T10:00:00.000Z',
    updatedAt: '2026-06-28T10:00:00.000Z',
    deletedAt: null,
    schemaVersion: 1,
    contactId: CONTACT_ID,
    occurredAt: '2026-06-28T09:00:00.000Z',
    type: 'meeting' as const,
    summary: 'Test meeting',
    location: null,
  };
}

describe('fetchInteractions', () => {
  it('calls the correct URL with the contactId', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ interactions: [] }),
    });

    await fetchInteractions(CONTACT_ID);

    expect(global.fetch).toHaveBeenCalledWith(
      `/api/interactions?contactId=${encodeURIComponent(CONTACT_ID)}`,
      undefined
    );
  });

  it('returns the interactions array from the response', async () => {
    const interaction = makeInteraction();
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ interactions: [interaction] }),
    });

    const result = await fetchInteractions(CONTACT_ID);

    expect(result.interactions).toHaveLength(1);
    expect(result.interactions[0].id).toBe(INTERACTION_ID);
  });

  it('returns empty array when no interactions exist', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ interactions: [] }),
    });

    const result = await fetchInteractions(CONTACT_ID);

    expect(result.interactions).toHaveLength(0);
  });

  it('throws ApiError on non-2xx response', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 400,
      json: () =>
        Promise.resolve({
          error: {
            type: 'ValidationError',
            message: 'contactId is required',
            debugBlock: '--- DEBUG BLOCK ---\n{}\n--- END DEBUG BLOCK ---',
          },
        }),
    });

    await expect(fetchInteractions(CONTACT_ID)).rejects.toThrow(ApiError);
  });
});

describe('createInteraction', () => {
  it('sends POST to /api/interactions with correct body', async () => {
    const interaction = makeInteraction();
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 201,
      json: () => Promise.resolve({ interaction }),
    });

    const input = {
      contactId: CONTACT_ID,
      occurredAt: '2026-06-28T09:00:00.000Z',
      type: 'meeting' as const,
      summary: 'Test meeting',
      location: null,
    };

    await createInteraction(input);

    expect(global.fetch).toHaveBeenCalledWith('/api/interactions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    });
  });

  it('returns the created interaction', async () => {
    const interaction = makeInteraction();
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 201,
      json: () => Promise.resolve({ interaction }),
    });

    const result = await createInteraction({
      contactId: CONTACT_ID,
      occurredAt: '2026-06-28T09:00:00.000Z',
      type: 'meeting',
    });

    expect(result.interaction.id).toBe(INTERACTION_ID);
    expect(result.interaction.type).toBe('meeting');
  });

  it('throws ApiError 400 on validation failure', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 400,
      json: () =>
        Promise.resolve({
          error: {
            type: 'ValidationError',
            message: 'Contact not found or deleted',
            debugBlock: '--- DEBUG BLOCK ---\n{}\n--- END DEBUG BLOCK ---',
          },
        }),
    });

    const err = await createInteraction({
      contactId: CONTACT_ID,
      occurredAt: '2026-06-28T09:00:00.000Z',
      type: 'meeting',
    }).catch((e) => e);

    expect(err).toBeInstanceOf(ApiError);
    expect((err as ApiError).statusCode).toBe(400);
    expect((err as ApiError).message).toBe('Contact not found or deleted');
  });
});

describe('deleteInteraction', () => {
  it('resolves void on 204 No Content', async () => {
    global.fetch = vi.fn().mockResolvedValue({ ok: true, status: 204 });

    await expect(deleteInteraction(INTERACTION_ID)).resolves.toBeUndefined();
    expect(global.fetch).toHaveBeenCalledWith(
      `/api/interactions/${INTERACTION_ID}`,
      { method: 'DELETE' }
    );
  });

  it('throws ApiError with parsed body on 404', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 404,
      json: () =>
        Promise.resolve({
          error: {
            type: 'NotFound',
            message: 'Interaction not found',
            debugBlock: '--- DEBUG BLOCK ---\n{}\n--- END DEBUG BLOCK ---',
          },
        }),
    });

    const err = await deleteInteraction(INTERACTION_ID).catch((e) => e);

    expect(err).toBeInstanceOf(ApiError);
    expect((err as ApiError).type).toBe('NotFound');
    expect((err as ApiError).message).toBe('Interaction not found');
    expect((err as ApiError).statusCode).toBe(404);
    expect((err as ApiError).debugBlock).toContain('DEBUG BLOCK');
  });

  it('throws ApiError with parsed body on 500', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
      json: () =>
        Promise.resolve({
          error: {
            type: 'StorageError',
            message: 'Disk write failed',
            debugBlock: '--- DEBUG BLOCK ---\n{}\n--- END DEBUG BLOCK ---',
          },
        }),
    });

    const err = await deleteInteraction(INTERACTION_ID).catch((e) => e);

    expect(err).toBeInstanceOf(ApiError);
    expect((err as ApiError).type).toBe('StorageError');
    expect((err as ApiError).statusCode).toBe(500);
  });

  it('throws ApiError with fallback message when error body is not JSON', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
      json: () => Promise.reject(new Error('Invalid JSON')),
    });

    const err = await deleteInteraction(INTERACTION_ID).catch((e) => e);

    expect(err).toBeInstanceOf(ApiError);
    expect((err as ApiError).message).toBe('HTTP 500');
    expect((err as ApiError).type).toBe('UnknownError');
    expect((err as ApiError).statusCode).toBe(500);
    expect((err as ApiError).debugBlock).toContain('DEBUG BLOCK');
  });

  it('throws NetworkError when fetch itself rejects', async () => {
    global.fetch = vi.fn().mockRejectedValue(new Error('Failed to fetch'));

    const err = await deleteInteraction(INTERACTION_ID).catch((e) => e);

    expect(err).toBeInstanceOf(NetworkError);
    expect((err as NetworkError).message).toBe('Failed to fetch');
    expect((err as NetworkError).cause).toBeInstanceOf(Error);
  });

  it('throws NetworkError with generic message on non-Error rejection', async () => {
    global.fetch = vi.fn().mockRejectedValue('connection reset');

    const err = await deleteInteraction(INTERACTION_ID).catch((e) => e);

    expect(err).toBeInstanceOf(NetworkError);
    expect((err as NetworkError).message).toBe('Network request failed');
  });
});
