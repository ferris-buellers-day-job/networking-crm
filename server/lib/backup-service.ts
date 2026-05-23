import { cp, rm, readdir, stat, access } from 'node:fs/promises';
import { execSync } from 'node:child_process';
import path from 'node:path';
import type { Logger } from './logger.js';

export interface BackupResult {
  committed: boolean;
  changedFiles: number;
  error?: string;
}

export interface BackupServiceDeps {
  logger: Logger;
}

/**
 * Paths/patterns to exclude from backup.
 * Aligns with FileWatcher exclusions.
 */
const EXCLUDED_PATHS = [
  'inbox.txt',
  'inbox-processed.txt',
  '.quarantine',
  'logs',
];

/**
 * Git-based backup service for DATA_PATH.
 *
 * Copies DATA_PATH (excluding inbox files, quarantine, logs) to BACKUP_PATH,
 * then stages and commits if changes exist. Local-only — never pushes to remote.
 *
 * IMPORTANT: The sync operation is NOT crash-atomic. If interrupted mid-copy,
 * the backup directory may be in an inconsistent state. The next successful
 * backup run will resolve this by syncing the complete current state.
 */
export class BackupService {
  private readonly dataPath: string;
  private readonly backupPath: string;
  private readonly logger: Logger;
  private schedulerInterval: NodeJS.Timeout | null = null;

  constructor(dataPath: string, backupPath: string, deps: BackupServiceDeps) {
    this.dataPath = dataPath;
    this.backupPath = backupPath;
    this.logger = deps.logger;
  }

  /**
   * Run a backup: sync files to backup repo, stage, and commit if changes exist.
   *
   * @returns BackupResult with committed status, changed file count, and any error
   */
  async run(): Promise<BackupResult> {
    this.logger.info('backup.started', 'Backup started', {
      dataPath: this.dataPath,
      backupPath: this.backupPath,
    });

    // Validate backup repo exists and is a git repo
    const repoCheck = await this.validateBackupRepo();
    if (repoCheck.error) {
      this.logger.error('backup.failed', 'Backup failed', { error: repoCheck.error });
      return { committed: false, changedFiles: 0, error: repoCheck.error };
    }

    try {
      // Sync files from dataPath to backupPath (mirror semantics)
      await this.syncFiles();

      // Stage all changes
      this.runGitCommand('add -A');

      // Check for changes
      const status = this.runGitCommand('status --porcelain');
      if (!status.trim()) {
        this.logger.info('backup.skipped', 'Backup skipped - no changes detected');
        return { committed: false, changedFiles: 0 };
      }

      // Count changed files
      const changedFiles = status.trim().split('\n').length;

      // Commit with timestamp
      const timestamp = new Date().toISOString().slice(0, 16).replace('T', ' ');
      const commitMessage = `backup: ${timestamp}`;
      this.runGitCommand(`commit -m "${commitMessage}"`);

      this.logger.info('backup.completed', 'Backup completed', {
        committed: true,
        changedFiles,
      });

      return { committed: true, changedFiles };
    } catch (err) {
      const errorMessage = (err as Error).message;
      this.logger.error('backup.failed', 'Backup failed', { error: errorMessage });
      return { committed: false, changedFiles: 0, error: errorMessage };
    }
  }

  /**
   * Start the daily backup scheduler.
   * Runs backup every 24 hours. Does NOT run immediately — caller should
   * call run() explicitly for an initial backup if desired.
   */
  startScheduler(): void {
    if (this.schedulerInterval) {
      return; // Already running
    }

    // Schedule daily backups (24 hours in ms)
    const TWENTY_FOUR_HOURS = 24 * 60 * 60 * 1000;
    this.schedulerInterval = setInterval(() => {
      this.run().catch(() => {
        // Error already logged in run()
      });
    }, TWENTY_FOUR_HOURS);
  }

  /**
   * Stop the daily backup scheduler.
   */
  stopScheduler(): void {
    if (this.schedulerInterval) {
      clearInterval(this.schedulerInterval);
      this.schedulerInterval = null;
    }
  }

  /**
   * Validate that backupPath exists, is a directory, and contains .git/.
   */
  private async validateBackupRepo(): Promise<{ error?: string }> {
    try {
      await access(this.backupPath);
    } catch {
      return { error: `Backup path does not exist: ${this.backupPath}` };
    }

    try {
      const stats = await stat(this.backupPath);
      if (!stats.isDirectory()) {
        return { error: `Backup path is not a directory: ${this.backupPath}` };
      }
    } catch (err) {
      return { error: `Cannot stat backup path: ${(err as Error).message}` };
    }

    try {
      const gitDir = path.join(this.backupPath, '.git');
      const gitStats = await stat(gitDir);
      if (!gitStats.isDirectory()) {
        return { error: `Backup path is not a git repository (no .git directory): ${this.backupPath}` };
      }
    } catch {
      return { error: `Backup path is not a git repository (no .git directory): ${this.backupPath}` };
    }

    return {};
  }

  /**
   * Sync files from dataPath to backupPath with mirror semantics.
   * Excluded paths are not copied, and files deleted from source are deleted from backup.
   */
  private async syncFiles(): Promise<void> {
    // Get list of items in dataPath
    const sourceItems = await readdir(this.dataPath);

    // Get list of items currently in backupPath (excluding .git)
    const backupItems = (await readdir(this.backupPath)).filter((item) => item !== '.git');

    // Copy each non-excluded item from source to backup
    for (const item of sourceItems) {
      if (this.isExcluded(item)) {
        continue;
      }

      const sourcePath = path.join(this.dataPath, item);
      const destPath = path.join(this.backupPath, item);

      // Remove existing item in backup first (for clean mirror)
      try {
        await rm(destPath, { recursive: true, force: true });
      } catch {
        // Ignore if doesn't exist
      }

      // Copy from source
      const sourceStats = await stat(sourcePath);
      if (sourceStats.isDirectory()) {
        await cp(sourcePath, destPath, {
          recursive: true,
          filter: (src) => !this.isExcluded(path.basename(src)),
        });
      } else {
        await cp(sourcePath, destPath);
      }
    }

    // Remove items from backup that no longer exist in source (mirror semantics)
    for (const item of backupItems) {
      if (!sourceItems.includes(item) || this.isExcluded(item)) {
        const destPath = path.join(this.backupPath, item);
        await rm(destPath, { recursive: true, force: true });
      }
    }
  }

  /**
   * Check if a path should be excluded from backup.
   */
  private isExcluded(itemName: string): boolean {
    return EXCLUDED_PATHS.includes(itemName);
  }

  /**
   * Run a git command in the backup directory.
   */
  private runGitCommand(command: string): string {
    return execSync(`git ${command}`, {
      cwd: this.backupPath,
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
    });
  }
}
