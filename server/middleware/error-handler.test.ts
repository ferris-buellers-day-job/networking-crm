import { describe, it, expect, vi, beforeEach } from 'vitest';
import express, { type Express } from 'express';
import request from 'supertest';
import { createErrorHandler } from './error-handler.js';
import {
  AppError,
  ValidationError,
  StorageError,
  NetworkError,
  QuarantineError,
} from '../lib/errors.js';
import type { Logger } from '../lib/logger.js';

describe('error-handler middleware', () => {
  let app: Express;
  let mockLogger: Logger;

  beforeEach(() => {
    mockLogger = {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
    };

    app = express();
    app.use(express.json());
  });

  function setupErrorHandler(): void {
    app.use(createErrorHandler(mockLogger));
  }

  describe('AppError handling', () => {
    it('converts ValidationError to 400 response', async () => {
      app.get('/test', () => {
        throw new ValidationError('Invalid input', { op: 'test.validate' });
      });
      setupErrorHandler();

      const res = await request(app).get('/test');

      expect(res.status).toBe(400);
      expect(res.body.error.type).toBe('ValidationError');
      expect(res.body.error.message).toBe('Invalid input');
      expect(res.body.error.debugBlock).toContain('--- DEBUG BLOCK ---');
      expect(res.body.error.debugBlock).toContain('--- END DEBUG BLOCK ---');
    });

    it('converts QuarantineError to 422 response', async () => {
      app.get('/test', () => {
        throw new QuarantineError('File quarantined', { op: 'fileStore.get' });
      });
      setupErrorHandler();

      const res = await request(app).get('/test');

      expect(res.status).toBe(422);
      expect(res.body.error.type).toBe('QuarantineError');
    });

    it('converts StorageError to 500 response', async () => {
      app.get('/test', () => {
        throw new StorageError('Disk full', { op: 'fileStore.save' });
      });
      setupErrorHandler();

      const res = await request(app).get('/test');

      expect(res.status).toBe(500);
      expect(res.body.error.type).toBe('StorageError');
    });

    it('converts NetworkError to 500 response (server-side)', async () => {
      app.get('/test', () => {
        throw new NetworkError('Connection refused', { op: 'api.call' });
      });
      setupErrorHandler();

      const res = await request(app).get('/test');

      expect(res.status).toBe(500);
      expect(res.body.error.type).toBe('NetworkError');
    });

    it('converts generic AppError to 500 response', async () => {
      app.get('/test', () => {
        throw new AppError('Something went wrong', { op: 'test.op' });
      });
      setupErrorHandler();

      const res = await request(app).get('/test');

      expect(res.status).toBe(500);
      expect(res.body.error.type).toBe('AppError');
    });
  });

  describe('unknown error handling', () => {
    it('wraps plain Error in AppError with 500 response', async () => {
      app.get('/test', () => {
        throw new Error('Unexpected error');
      });
      setupErrorHandler();

      const res = await request(app).get('/test');

      expect(res.status).toBe(500);
      expect(res.body.error.type).toBe('AppError');
      expect(res.body.error.message).toBe('Unexpected error');
      expect(res.body.error.debugBlock).toContain('server.unhandledError');
    });

    it('wraps string throw in AppError', async () => {
      app.get('/test', () => {
        // eslint-disable-next-line @typescript-eslint/no-throw-literal
        throw 'string error';
      });
      setupErrorHandler();

      const res = await request(app).get('/test');

      expect(res.status).toBe(500);
      expect(res.body.error.type).toBe('AppError');
      expect(res.body.error.message).toBe('An unexpected error occurred');
    });

    // Note: Express 4 does not forward `throw null` to error middleware (returns 404).
    // This is Express internal behavior, not testable at the middleware level.
  });

  describe('logging', () => {
    it('logs error via logger.error', async () => {
      app.get('/test', () => {
        throw new ValidationError('Bad data', {
          op: 'test.validate',
          context: { field: 'email' },
        });
      });
      setupErrorHandler();

      await request(app).get('/test');

      expect(mockLogger.error).toHaveBeenCalledWith(
        'test.validate',
        'Bad data',
        expect.objectContaining({
          type: 'ValidationError',
          statusCode: 400,
          context: { field: 'email' },
        })
      );
    });
  });

  describe('safety handling', () => {
    it('delegates to next() when headers already sent', async () => {
      // Route that sends response then throws (simulates streaming error)
      app.get('/test', (_req, res) => {
        res.status(200).send('partial response');
        throw new Error('Error after headers sent');
      });
      setupErrorHandler();

      // The request should complete with the partial response (200)
      // and not crash. The error is delegated to Express's default handler.
      const res = await request(app).get('/test');

      expect(res.status).toBe(200);
      expect(res.text).toBe('partial response');
      // Logger should NOT be called since we delegated to next()
      expect(mockLogger.error).not.toHaveBeenCalled();
    });
  });

  describe('response format', () => {
    it('includes all required fields in error response', async () => {
      app.get('/test', () => {
        throw new ValidationError('Test error', {
          op: 'test.op',
          context: { key: 'value' },
        });
      });
      setupErrorHandler();

      const res = await request(app).get('/test');

      expect(res.body).toHaveProperty('error');
      expect(res.body.error).toHaveProperty('type');
      expect(res.body.error).toHaveProperty('message');
      expect(res.body.error).toHaveProperty('debugBlock');
    });

    it('debug block contains valid JSON', async () => {
      app.get('/test', () => {
        throw new ValidationError('Test', { op: 'test.op' });
      });
      setupErrorHandler();

      const res = await request(app).get('/test');

      const debugBlock = res.body.error.debugBlock;
      const match = debugBlock.match(/--- DEBUG BLOCK ---\n([\s\S]*)\n--- END DEBUG BLOCK ---/);
      expect(match).not.toBeNull();

      const json = JSON.parse(match![1]);
      expect(json).toHaveProperty('ts');
      expect(json).toHaveProperty('error', 'ValidationError');
      expect(json).toHaveProperty('message', 'Test');
      expect(json).toHaveProperty('op', 'test.op');
    });
  });
});
