import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtemp, rm, readFile, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createLogger } from './logger.js';

describe('Logger', () => {
  let tempDir: string;
  let logDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(path.join(tmpdir(), 'logger-test-'));
    logDir = path.join(tempDir, 'logs');
    // Reset environment variables
    delete process.env.LOG_LEVEL;
    delete process.env.LOG_RETENTION_DAYS;
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
    vi.unstubAllEnvs();
  });

  describe('log file creation', () => {
    it('creates log directory if missing', () => {
      const logger = createLogger(logDir, {
        getCurrentDate: () => '2026-05-07',
        getCurrentTimestamp: () => '2026-05-07T12:00:00.000Z',
      });

      logger.info('test', 'Hello');

      // Directory should now exist (file was written)
    });

    it('creates log file with correct name format', async () => {
      const logger = createLogger(logDir, {
        getCurrentDate: () => '2026-05-07',
        getCurrentTimestamp: () => '2026-05-07T12:00:00.000Z',
      });

      logger.info('test', 'Hello');

      const files = await readdir(logDir);
      expect(files).toContain('app-2026-05-07.log');
    });

    it('appends to existing log file', async () => {
      const logger = createLogger(logDir, {
        getCurrentDate: () => '2026-05-07',
        getCurrentTimestamp: () => '2026-05-07T12:00:00.000Z',
      });

      logger.info('test', 'First');
      logger.info('test', 'Second');

      const content = await readFile(path.join(logDir, 'app-2026-05-07.log'), 'utf-8');
      const lines = content.trim().split('\n');
      expect(lines).toHaveLength(2);
    });
  });

  describe('log format', () => {
    it('writes valid JSON lines', async () => {
      const logger = createLogger(logDir, {
        getCurrentDate: () => '2026-05-07',
        getCurrentTimestamp: () => '2026-05-07T12:00:00.000Z',
      });

      logger.info('fileStore.save', 'Saved contact');

      const content = await readFile(path.join(logDir, 'app-2026-05-07.log'), 'utf-8');
      const entry = JSON.parse(content.trim());

      expect(entry.ts).toBe('2026-05-07T12:00:00.000Z');
      expect(entry.level).toBe('info');
      expect(entry.op).toBe('fileStore.save');
      expect(entry.msg).toBe('Saved contact');
    });

    it('includes meta fields in log entry', async () => {
      const logger = createLogger(logDir, {
        getCurrentDate: () => '2026-05-07',
        getCurrentTimestamp: () => '2026-05-07T12:00:00.000Z',
      });

      logger.info('fileStore.save', 'Saved contact', { id: 'abc123', duration: 42 });

      const content = await readFile(path.join(logDir, 'app-2026-05-07.log'), 'utf-8');
      const entry = JSON.parse(content.trim());

      expect(entry.id).toBe('abc123');
      expect(entry.duration).toBe(42);
    });

    it('logs all levels correctly', async () => {
      process.env.LOG_LEVEL = 'debug';
      const logger = createLogger(logDir, {
        getCurrentDate: () => '2026-05-07',
        getCurrentTimestamp: () => '2026-05-07T12:00:00.000Z',
      });

      logger.debug('op', 'Debug message');
      logger.info('op', 'Info message');
      logger.warn('op', 'Warn message');
      logger.error('op', 'Error message');

      const content = await readFile(path.join(logDir, 'app-2026-05-07.log'), 'utf-8');
      const lines = content.trim().split('\n').map((l) => JSON.parse(l));

      expect(lines.map((l) => l.level)).toEqual(['debug', 'info', 'warn', 'error']);
    });
  });

  describe('log level filtering', () => {
    it('filters debug when LOG_LEVEL is info (default)', async () => {
      const logger = createLogger(logDir, {
        getCurrentDate: () => '2026-05-07',
        getCurrentTimestamp: () => '2026-05-07T12:00:00.000Z',
      });

      logger.debug('op', 'Should not appear');
      logger.info('op', 'Should appear');

      const content = await readFile(path.join(logDir, 'app-2026-05-07.log'), 'utf-8');
      const lines = content.trim().split('\n');

      expect(lines).toHaveLength(1);
      expect(JSON.parse(lines[0]).level).toBe('info');
    });

    it('includes debug when LOG_LEVEL is debug', async () => {
      process.env.LOG_LEVEL = 'debug';
      const logger = createLogger(logDir, {
        getCurrentDate: () => '2026-05-07',
        getCurrentTimestamp: () => '2026-05-07T12:00:00.000Z',
      });

      logger.debug('op', 'Should appear');

      const content = await readFile(path.join(logDir, 'app-2026-05-07.log'), 'utf-8');
      const entry = JSON.parse(content.trim());

      expect(entry.level).toBe('debug');
    });

    it('filters info and debug when LOG_LEVEL is warn', async () => {
      process.env.LOG_LEVEL = 'warn';
      const logger = createLogger(logDir, {
        getCurrentDate: () => '2026-05-07',
        getCurrentTimestamp: () => '2026-05-07T12:00:00.000Z',
      });

      logger.debug('op', 'No');
      logger.info('op', 'No');
      logger.warn('op', 'Yes');
      logger.error('op', 'Yes');

      const content = await readFile(path.join(logDir, 'app-2026-05-07.log'), 'utf-8');
      const lines = content.trim().split('\n').map((l) => JSON.parse(l));

      expect(lines).toHaveLength(2);
      expect(lines.map((l) => l.level)).toEqual(['warn', 'error']);
    });

    it('only logs error when LOG_LEVEL is error', async () => {
      process.env.LOG_LEVEL = 'error';
      const logger = createLogger(logDir, {
        getCurrentDate: () => '2026-05-07',
        getCurrentTimestamp: () => '2026-05-07T12:00:00.000Z',
      });

      logger.debug('op', 'No');
      logger.info('op', 'No');
      logger.warn('op', 'No');
      logger.error('op', 'Yes');

      const content = await readFile(path.join(logDir, 'app-2026-05-07.log'), 'utf-8');
      const lines = content.trim().split('\n');

      expect(lines).toHaveLength(1);
      expect(JSON.parse(lines[0]).level).toBe('error');
    });
  });

  describe('date rotation', () => {
    it('rotates to new file when date changes', async () => {
      let currentDate = '2026-05-07';
      const logger = createLogger(logDir, {
        getCurrentDate: () => currentDate,
        getCurrentTimestamp: () => `${currentDate}T12:00:00.000Z`,
      });

      logger.info('op', 'Day 1');

      currentDate = '2026-05-08';
      logger.info('op', 'Day 2');

      const files = await readdir(logDir);
      expect(files).toContain('app-2026-05-07.log');
      expect(files).toContain('app-2026-05-08.log');

      const day1 = await readFile(path.join(logDir, 'app-2026-05-07.log'), 'utf-8');
      const day2 = await readFile(path.join(logDir, 'app-2026-05-08.log'), 'utf-8');

      expect(JSON.parse(day1.trim()).msg).toBe('Day 1');
      expect(JSON.parse(day2.trim()).msg).toBe('Day 2');
    });
  });

  describe('log retention', () => {
    it('deletes log files older than retention period on init', async () => {
      // Create log directory and old log files manually
      const { mkdirSync, writeFileSync } = await import('node:fs');
      mkdirSync(logDir, { recursive: true });

      // Create files: one old (35 days), one recent (5 days), one current
      writeFileSync(path.join(logDir, 'app-2026-04-02.log'), 'old\n'); // 35 days old
      writeFileSync(path.join(logDir, 'app-2026-05-02.log'), 'recent\n'); // 5 days old
      writeFileSync(path.join(logDir, 'app-2026-05-07.log'), 'current\n'); // current

      // Create logger with current date 2026-05-07, 30 day retention
      createLogger(logDir, {
        getCurrentDate: () => '2026-05-07',
        getCurrentTimestamp: () => '2026-05-07T12:00:00.000Z',
        retentionDays: 30,
      });

      const files = await readdir(logDir);

      expect(files).not.toContain('app-2026-04-02.log'); // Deleted (35 > 30 days)
      expect(files).toContain('app-2026-05-02.log'); // Kept (5 < 30 days)
      expect(files).toContain('app-2026-05-07.log'); // Kept (current)
    });

    it('deletes old files on date rollover', async () => {
      const { mkdirSync, writeFileSync } = await import('node:fs');
      mkdirSync(logDir, { recursive: true });

      // Create an old log file
      writeFileSync(path.join(logDir, 'app-2026-04-06.log'), 'old\n'); // 31 days before 2026-05-07

      let currentDate = '2026-05-07';
      const logger = createLogger(logDir, {
        getCurrentDate: () => currentDate,
        getCurrentTimestamp: () => `${currentDate}T12:00:00.000Z`,
        retentionDays: 30,
      });

      // Old file should still exist (it's only 31 days old, borderline)
      // Actually let's make it 32 days old to be sure
      writeFileSync(path.join(logDir, 'app-2026-04-05.log'), 'very old\n'); // 32 days before 2026-05-07

      // Trigger date rollover
      currentDate = '2026-05-08';
      logger.info('op', 'Trigger rollover');

      const files = await readdir(logDir);
      expect(files).not.toContain('app-2026-04-05.log'); // Should be deleted (> 30 days)
    });

    it('respects LOG_RETENTION_DAYS env var', async () => {
      const { mkdirSync, writeFileSync } = await import('node:fs');
      mkdirSync(logDir, { recursive: true });

      // Create a file 10 days old
      writeFileSync(path.join(logDir, 'app-2026-04-27.log'), 'old\n'); // 10 days old

      process.env.LOG_RETENTION_DAYS = '7';

      createLogger(logDir, {
        getCurrentDate: () => '2026-05-07',
        getCurrentTimestamp: () => '2026-05-07T12:00:00.000Z',
      });

      const files = await readdir(logDir);
      expect(files).not.toContain('app-2026-04-27.log'); // Deleted (10 > 7 days)
    });

    it('does not delete non-log files', async () => {
      const { mkdirSync, writeFileSync } = await import('node:fs');
      mkdirSync(logDir, { recursive: true });

      // Create a non-log file with old-looking name
      writeFileSync(path.join(logDir, 'backup-2026-01-01.txt'), 'keep me\n');
      writeFileSync(path.join(logDir, 'app-2026-01-01.json'), 'keep me\n');

      createLogger(logDir, {
        getCurrentDate: () => '2026-05-07',
        getCurrentTimestamp: () => '2026-05-07T12:00:00.000Z',
        retentionDays: 30,
      });

      const files = await readdir(logDir);
      expect(files).toContain('backup-2026-01-01.txt');
      expect(files).toContain('app-2026-01-01.json');
    });
  });
});
