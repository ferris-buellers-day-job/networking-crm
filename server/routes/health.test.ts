import { describe, it, expect, vi, beforeEach } from 'vitest';
import express, { type Express } from 'express';
import request from 'supertest';
import { createHealthRouter } from './health.js';
import type { IntegrityReport } from '../lib/integrity-check.js';

// Mock child_process to control git commit output
vi.mock('child_process', () => ({
  execSync: vi.fn(() => 'abc1234'),
}));

describe('health router', () => {
  let app: Express;

  function setupHealthRouter(report: Partial<IntegrityReport>): void {
    const fullReport: IntegrityReport = {
      schemaVersionOk: true,
      expectedSchemaVersion: 1,
      foundSchemaVersion: 1,
      conflictFiles: [],
      quarantinedFiles: [],
      orphanedReferences: [],
      errors: [],
      cacheRebuilt: false,
      ...report,
    };

    const router = createHealthRouter({
      integrityReport: fullReport,
      integrityCheckedAt: '2026-05-31T12:00:00.000Z',
    });

    app = express();
    app.use('/api', router);
  }

  describe('GET /api/health', () => {
    describe('status field', () => {
      it('returns status "ok" when no warnings and schema version is ok', async () => {
        setupHealthRouter({
          schemaVersionOk: true,
          conflictFiles: [],
          quarantinedFiles: [],
          errors: [],
          cacheRebuilt: false,
        });

        const res = await request(app).get('/api/health');

        expect(res.status).toBe(200);
        expect(res.body.status).toBe('ok');
      });

      it('returns status "degraded" when conflict files exist', async () => {
        setupHealthRouter({
          conflictFiles: ['/path/to/conflict.txt'],
        });

        const res = await request(app).get('/api/health');

        expect(res.body.status).toBe('degraded');
      });

      it('returns status "degraded" when quarantined files exist', async () => {
        setupHealthRouter({
          quarantinedFiles: ['/path/to/quarantined.json'],
        });

        const res = await request(app).get('/api/health');

        expect(res.body.status).toBe('degraded');
      });

      it('returns status "degraded" when errors exist', async () => {
        setupHealthRouter({
          errors: ['Some integrity error'],
        });

        const res = await request(app).get('/api/health');

        expect(res.body.status).toBe('degraded');
      });

      it('returns status "degraded" when cache was rebuilt', async () => {
        setupHealthRouter({
          cacheRebuilt: true,
        });

        const res = await request(app).get('/api/health');

        expect(res.body.status).toBe('degraded');
      });

      it('returns status "error" when schema version is not ok', async () => {
        setupHealthRouter({
          schemaVersionOk: false,
        });

        const res = await request(app).get('/api/health');

        expect(res.body.status).toBe('error');
      });

      it('prioritizes "error" over "degraded" when both conditions apply', async () => {
        setupHealthRouter({
          schemaVersionOk: false,
          conflictFiles: ['/path/to/conflict.txt'],
          quarantinedFiles: ['/path/to/quarantined.json'],
        });

        const res = await request(app).get('/api/health');

        expect(res.body.status).toBe('error');
      });
    });

    describe('response format', () => {
      beforeEach(() => {
        setupHealthRouter({});
      });

      it('includes version from package.json', async () => {
        const res = await request(app).get('/api/health');

        expect(res.body).toHaveProperty('version');
        expect(typeof res.body.version).toBe('string');
      });

      it('includes git commit hash', async () => {
        const res = await request(app).get('/api/health');

        expect(res.body.commit).toBe('abc1234');
      });

      it('includes integrity object with expected fields', async () => {
        const res = await request(app).get('/api/health');

        expect(res.body.integrity).toHaveProperty('ok');
        expect(res.body.integrity).toHaveProperty('warnings');
        expect(res.body.integrity).toHaveProperty('lastChecked');
      });

      it('integrity.ok is true when no warnings', async () => {
        const res = await request(app).get('/api/health');

        expect(res.body.integrity.ok).toBe(true);
        expect(res.body.integrity.warnings).toBe(0);
      });

      it('integrity.ok is false when warnings exist', async () => {
        setupHealthRouter({
          conflictFiles: ['file1.txt', 'file2.txt'],
        });

        const res = await request(app).get('/api/health');

        expect(res.body.integrity.ok).toBe(false);
        expect(res.body.integrity.warnings).toBe(2);
      });

      it('includes lastChecked timestamp', async () => {
        const res = await request(app).get('/api/health');

        expect(res.body.integrity.lastChecked).toBe('2026-05-31T12:00:00.000Z');
      });
    });

    describe('warning count', () => {
      it('sums all warning sources', async () => {
        setupHealthRouter({
          conflictFiles: ['c1.txt', 'c2.txt'],
          quarantinedFiles: ['q1.json'],
          errors: ['e1', 'e2', 'e3'],
          cacheRebuilt: true,
        });

        const res = await request(app).get('/api/health');

        // 2 conflicts + 1 quarantined + 3 errors + 1 cacheRebuilt = 7
        expect(res.body.integrity.warnings).toBe(7);
      });
    });
  });
});
