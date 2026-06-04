import { describe, it, expect, vi, beforeEach } from 'vitest';
import express, { type Express } from 'express';
import request from 'supertest';
import { createClientErrorRouter } from './client-error.js';
import type { Logger } from '../lib/logger.js';

describe('client-error router', () => {
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
    app.use('/api', createClientErrorRouter({ logger: mockLogger }));
  });

  describe('POST /api/log-client-error', () => {
    it('returns 204 on valid request', async () => {
      const res = await request(app)
        .post('/api/log-client-error')
        .send({
          debugBlock: '--- DEBUG BLOCK ---\n{}\n--- END DEBUG BLOCK ---',
          url: 'http://localhost:3000/contacts',
          userAgent: 'Mozilla/5.0',
        });

      expect(res.status).toBe(204);
      expect(res.body).toEqual({});
    });

    it('logs error with op: client.error', async () => {
      const debugBlock = '--- DEBUG BLOCK ---\n{"error":"TestError"}\n--- END DEBUG BLOCK ---';

      await request(app)
        .post('/api/log-client-error')
        .send({
          debugBlock,
          url: 'http://localhost:3000/contacts',
          userAgent: 'Mozilla/5.0',
        });

      expect(mockLogger.error).toHaveBeenCalledWith(
        'client.error',
        'Client-side error reported',
        expect.objectContaining({
          debugBlock,
          url: 'http://localhost:3000/contacts',
          userAgent: 'Mozilla/5.0',
        })
      );
    });

    it('returns 400 when debugBlock is missing', async () => {
      const res = await request(app)
        .post('/api/log-client-error')
        .send({
          url: 'http://localhost:3000/contacts',
          userAgent: 'Mozilla/5.0',
        });

      expect(res.status).toBe(400);
      expect(res.body.error.message).toBe('debugBlock is required');
    });

    it('returns 400 when debugBlock is empty string', async () => {
      const res = await request(app)
        .post('/api/log-client-error')
        .send({
          debugBlock: '',
          url: 'http://localhost:3000/contacts',
          userAgent: 'Mozilla/5.0',
        });

      expect(res.status).toBe(400);
    });

    it('handles missing optional fields gracefully', async () => {
      await request(app)
        .post('/api/log-client-error')
        .send({
          debugBlock: '--- DEBUG BLOCK ---\n{}\n--- END DEBUG BLOCK ---',
        });

      expect(mockLogger.error).toHaveBeenCalledWith(
        'client.error',
        'Client-side error reported',
        expect.objectContaining({
          url: 'unknown',
          userAgent: 'unknown',
        })
      );
    });

    it('handles empty body', async () => {
      const res = await request(app)
        .post('/api/log-client-error')
        .send({});

      expect(res.status).toBe(400);
    });
  });
});
