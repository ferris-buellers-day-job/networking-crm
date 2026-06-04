// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { apiFetch } from './api.js';
import { ApiError, NetworkError } from './api-error.js';

describe('apiFetch', () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    vi.resetAllMocks();
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  describe('successful responses', () => {
    it('returns parsed JSON on 200 response', async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ data: 'test' }),
      });

      const result = await apiFetch<{ data: string }>('/api/test');

      expect(result).toEqual({ data: 'test' });
    });

    it('passes options to fetch', async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({}),
      });

      await apiFetch('/api/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ foo: 'bar' }),
      });

      expect(global.fetch).toHaveBeenCalledWith('/api/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ foo: 'bar' }),
      });
    });
  });

  describe('error responses', () => {
    it('throws ApiError on non-2xx with server error response', async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 400,
        json: () =>
          Promise.resolve({
            error: {
              type: 'ValidationError',
              message: 'Invalid input',
              debugBlock: '--- DEBUG BLOCK ---\n{}\n--- END DEBUG BLOCK ---',
            },
          }),
      });

      await expect(apiFetch('/api/test')).rejects.toThrow(ApiError);

      try {
        await apiFetch('/api/test');
      } catch (err) {
        expect(err).toBeInstanceOf(ApiError);
        const apiErr = err as ApiError;
        expect(apiErr.message).toBe('Invalid input');
        expect(apiErr.type).toBe('ValidationError');
        expect(apiErr.statusCode).toBe(400);
        expect(apiErr.debugBlock).toContain('DEBUG BLOCK');
      }
    });

    it('throws ApiError with fallback on non-JSON error response', async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 502,
        json: () => Promise.reject(new Error('Invalid JSON')),
      });

      await expect(apiFetch('/api/test')).rejects.toThrow(ApiError);

      try {
        await apiFetch('/api/test');
      } catch (err) {
        expect(err).toBeInstanceOf(ApiError);
        const apiErr = err as ApiError;
        expect(apiErr.message).toBe('HTTP 502');
        expect(apiErr.type).toBe('UnknownError');
        expect(apiErr.statusCode).toBe(502);
      }
    });

    it('throws ApiError on 500 response', async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 500,
        json: () =>
          Promise.resolve({
            error: {
              type: 'StorageError',
              message: 'Disk full',
              debugBlock: '--- DEBUG BLOCK ---\n{}\n--- END DEBUG BLOCK ---',
            },
          }),
      });

      await expect(apiFetch('/api/test')).rejects.toThrow(ApiError);
    });
  });

  describe('network errors', () => {
    it('throws NetworkError on fetch rejection', async () => {
      global.fetch = vi.fn().mockRejectedValue(new Error('Failed to fetch'));

      await expect(apiFetch('/api/test')).rejects.toThrow(NetworkError);

      try {
        await apiFetch('/api/test');
      } catch (err) {
        expect(err).toBeInstanceOf(NetworkError);
        const netErr = err as NetworkError;
        expect(netErr.message).toBe('Failed to fetch');
        expect(netErr.cause).toBeInstanceOf(Error);
      }
    });

    it('throws NetworkError with generic message on non-Error rejection', async () => {
      global.fetch = vi.fn().mockRejectedValue('network down');

      await expect(apiFetch('/api/test')).rejects.toThrow(NetworkError);

      try {
        await apiFetch('/api/test');
      } catch (err) {
        expect(err).toBeInstanceOf(NetworkError);
        expect((err as NetworkError).message).toBe('Network request failed');
      }
    });
  });
});
