import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtemp, rm, writeFile, mkdir, readdir, readFile } from 'node:fs/promises';
import { execSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { BackupService } from './backup-service.js';
import type { Logger } from './logger.js';

// Mock logger that captures log calls
function createMockLogger(): Logger & { calls: { level: string; op: string; msg: string; meta?: object }[] } {
  const calls: { level: string; op: string; msg: string; meta?: object }[] = [];
  return {
    calls,
    debug(op, msg, meta) {
      calls.push({ level: 'debug', op, msg, meta });
    },
    info(op, msg, meta) {
      calls.push({ level: 'info', op, msg, meta });
    },
    warn(op, msg, meta) {
      calls.push({ level: 'warn', op, msg, meta });
    },
    error(op, msg, meta) {
      calls.push({ level: 'error', op, msg, meta });
    },
  };
}

// Helper to initialize a git repo
function initGitRepo(dir: string): void {
  execSync('git init', { cwd: dir, stdio: 'pipe' });
  execSync('git config user.email "test@test.com"', { cwd: dir, stdio: 'pipe' });
  execSync('git config user.name "Test"', { cwd: dir, stdio: 'pipe' });
  // Create initial commit so we have a valid repo state
  execSync('git commit --allow-empty -m "Initial commit"', { cwd: dir, stdio: 'pipe' });
}

// Helper to get the latest commit message
function getLatestCommitMessage(dir: string): string {
  return execSync('git log -1 --format=%s', { cwd: dir, encoding: 'utf-8' }).trim();
}

describe('BackupService', () => {
  let tempDir: string;
  let dataPath: string;
  let backupPath: string;
  let logger: ReturnType<typeof createMockLogger>;
  let service: BackupService;

  beforeEach(async () => {
    tempDir = await mkdtemp(path.join(tmpdir(), 'backup-service-test-'));
    dataPath = path.join(tempDir, 'data');
    backupPath = path.join(tempDir, 'backup');

    await mkdir(dataPath, { recursive: true });
    await mkdir(backupPath, { recursive: true });

    // Initialize backup as a git repo
    initGitRepo(backupPath);

    logger = createMockLogger();
    service = new BackupService(dataPath, backupPath, { logger });
  });

  afterEach(async () => {
    service.stopScheduler();
    await rm(tempDir, { recursive: true, force: true });
  });

  describe('run()', () => {
    it('commits when changes exist in dataPath', async () => {
      // Create a file in dataPath
      await writeFile(path.join(dataPath, 'contact.json'), '{"id": "123"}');

      const result = await service.run();

      expect(result.committed).toBe(true);
      expect(result.changedFiles).toBe(1);
      expect(result.error).toBeUndefined();

      // Verify file exists in backup
      const backupFiles = await readdir(backupPath);
      expect(backupFiles).toContain('contact.json');

      // Verify logger was called
      const completedLog = logger.calls.find((c) => c.op === 'backup.completed');
      expect(completedLog).toBeDefined();
    });

    it('returns no-op when no changes exist', async () => {
      // First backup to establish baseline
      await writeFile(path.join(dataPath, 'contact.json'), '{"id": "123"}');
      await service.run();

      // Second backup with no changes
      const result = await service.run();

      expect(result.committed).toBe(false);
      expect(result.changedFiles).toBe(0);
      expect(result.error).toBeUndefined();

      // Verify logger shows skipped
      const skippedLog = logger.calls.find((c) => c.op === 'backup.skipped');
      expect(skippedLog).toBeDefined();
    });

    it('returns error when backup path does not exist', async () => {
      const nonExistentPath = path.join(tempDir, 'does-not-exist');
      const badService = new BackupService(dataPath, nonExistentPath, { logger });

      const result = await badService.run();

      expect(result.committed).toBe(false);
      expect(result.error).toContain('does not exist');
    });

    it('returns error when backup path is not a git repo', async () => {
      // Create a directory that is not a git repo
      const notGitPath = path.join(tempDir, 'not-git');
      await mkdir(notGitPath, { recursive: true });

      const badService = new BackupService(dataPath, notGitPath, { logger });

      const result = await badService.run();

      expect(result.committed).toBe(false);
      expect(result.error).toContain('not a git repository');
    });

    it('excludes inbox.txt from backup', async () => {
      await writeFile(path.join(dataPath, 'inbox.txt'), 'some inbox content');
      await writeFile(path.join(dataPath, 'contact.json'), '{"id": "123"}');

      await service.run();

      const backupFiles = await readdir(backupPath);
      expect(backupFiles).not.toContain('inbox.txt');
      expect(backupFiles).toContain('contact.json');
    });

    it('excludes inbox-processed.txt from backup', async () => {
      await writeFile(path.join(dataPath, 'inbox-processed.txt'), 'processed content');
      await writeFile(path.join(dataPath, 'contact.json'), '{"id": "123"}');

      await service.run();

      const backupFiles = await readdir(backupPath);
      expect(backupFiles).not.toContain('inbox-processed.txt');
      expect(backupFiles).toContain('contact.json');
    });

    it('excludes .quarantine directory from backup', async () => {
      await mkdir(path.join(dataPath, '.quarantine'), { recursive: true });
      await writeFile(path.join(dataPath, '.quarantine', 'bad.json'), '{}');
      await writeFile(path.join(dataPath, 'contact.json'), '{"id": "123"}');

      await service.run();

      const backupFiles = await readdir(backupPath);
      expect(backupFiles).not.toContain('.quarantine');
      expect(backupFiles).toContain('contact.json');
    });

    it('excludes logs directory from backup', async () => {
      await mkdir(path.join(dataPath, 'logs'), { recursive: true });
      await writeFile(path.join(dataPath, 'logs', 'app.log'), 'log content');
      await writeFile(path.join(dataPath, 'contact.json'), '{"id": "123"}');

      await service.run();

      const backupFiles = await readdir(backupPath);
      expect(backupFiles).not.toContain('logs');
      expect(backupFiles).toContain('contact.json');
    });

    it('mirrors deletions from dataPath to backupPath', async () => {
      // Create file and backup
      await writeFile(path.join(dataPath, 'to-delete.json'), '{"id": "456"}');
      const firstResult = await service.run();
      expect(firstResult.committed).toBe(true);

      // Verify file exists in backup
      let backupFiles = await readdir(backupPath);
      expect(backupFiles).toContain('to-delete.json');

      // Delete file from dataPath
      await rm(path.join(dataPath, 'to-delete.json'));

      // Run backup again
      const secondResult = await service.run();
      expect(secondResult.committed).toBe(true);

      // Verify file is gone from backup
      backupFiles = await readdir(backupPath);
      expect(backupFiles).not.toContain('to-delete.json');

      // Verify commit reflects the deletion
      const commitMessage = getLatestCommitMessage(backupPath);
      expect(commitMessage).toMatch(/^backup: \d{4}-\d{2}-\d{2} \d{2}:\d{2}$/);
    });

    it('creates commit message in correct format: backup: YYYY-MM-DD HH:mm', async () => {
      await writeFile(path.join(dataPath, 'test.json'), '{"test": true}');

      await service.run();

      const commitMessage = getLatestCommitMessage(backupPath);
      // Format: backup: 2026-05-17 14:32
      expect(commitMessage).toMatch(/^backup: \d{4}-\d{2}-\d{2} \d{2}:\d{2}$/);
    });

    it('handles nested directories correctly', async () => {
      await mkdir(path.join(dataPath, 'contacts'), { recursive: true });
      await writeFile(path.join(dataPath, 'contacts', 'alice.json'), '{"name": "Alice"}');
      await writeFile(path.join(dataPath, 'contacts', 'bob.json'), '{"name": "Bob"}');

      const result = await service.run();

      expect(result.committed).toBe(true);

      // Verify nested structure is preserved
      const contactsDir = path.join(backupPath, 'contacts');
      const contactFiles = await readdir(contactsDir);
      expect(contactFiles).toContain('alice.json');
      expect(contactFiles).toContain('bob.json');

      // Verify content is correct
      const aliceContent = await readFile(path.join(contactsDir, 'alice.json'), 'utf-8');
      expect(aliceContent).toBe('{"name": "Alice"}');
    });
  });

  describe('scheduler', () => {
    it('can be started and stopped', () => {
      // startScheduler should not throw and should be callable
      service.startScheduler();

      // stopScheduler should cleanly stop
      service.stopScheduler();

      // Should be able to restart
      service.startScheduler();
      service.stopScheduler();
    });

    it('startScheduler does not run backup immediately', async () => {
      await writeFile(path.join(dataPath, 'test.json'), '{"id": "1"}');

      service.startScheduler();

      // Give it a moment to potentially run
      await new Promise((r) => setTimeout(r, 50));

      // No backup should have run - scheduler only fires after 24h
      const startedLogs = logger.calls.filter((c) => c.op === 'backup.started');
      expect(startedLogs.length).toBe(0);

      service.stopScheduler();
    });

    it('startScheduler is idempotent', () => {
      // Call start multiple times - should not throw or create multiple intervals
      service.startScheduler();
      service.startScheduler();
      service.startScheduler();

      service.stopScheduler();
    });

    it('stopScheduler is safe to call when not running', () => {
      // Should not throw
      service.stopScheduler();
      service.stopScheduler();
    });
  });
});
