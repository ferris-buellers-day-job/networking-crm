import chokidar from 'chokidar';
import type { FSWatcher } from 'chokidar';
import { access } from 'node:fs/promises';
import path from 'node:path';
import type { RecentWrites } from './recent-writes.js';
import type { Logger } from './logger.js';

export type FileWatcherEvent = 'add' | 'change' | 'unlink';
export type FileWatcherState = 'idle' | 'starting' | 'running' | 'stopping' | 'stopped';

export interface FileWatcherDeps {
  recentWrites: RecentWrites;
  logger: Logger;
}

export interface FileWatcherOptions {
  /** Debounce delay in milliseconds. Default: 300 */
  debounceMs?: number;
  /** Callback fired for file events after debounce and self-write filtering */
  onFileChange: (absolutePath: string, event: FileWatcherEvent) => Promise<void>;
  /** Callback fired when chokidar encounters an error */
  onError: (err: Error) => void;
}

interface PendingEvent {
  absolutePath: string;
  event: FileWatcherEvent;
  timer: NodeJS.Timeout;
}

// How long to remember dropped add events (for suppressing subsequent unlinks)
const DROPPED_ADD_TTL_MS = 1000;

/**
 * Watches a data directory for file changes using chokidar.
 *
 * Features:
 * - Debounced events (default 300ms) to batch rapid changes
 * - Self-write suppression via RecentWrites integration
 * - Ignores .quarantine/, *.tmp.*, inbox.txt, inbox-processed.txt, obsidian/
 * - Clean start/stop lifecycle with explicit state machine
 */
export class FileWatcher {
  private readonly dataPath: string;
  private readonly recentWrites: RecentWrites;
  private readonly logger: Logger;
  private readonly debounceMs: number;
  private readonly onFileChange: FileWatcherOptions['onFileChange'];
  private readonly onError: FileWatcherOptions['onError'];

  private state: FileWatcherState = 'idle';
  private watcher: FSWatcher | null = null;
  private pendingEvents: Map<string, PendingEvent> = new Map();
  // Track add events that were dropped due to file not existing at delivery time
  // Used to suppress subsequent unlink events for the same path
  // Value is the timestamp when the add was dropped
  private droppedAdds: Map<string, number> = new Map();
  // Cleanup timers for droppedAdds entries (auto-expire after TTL)
  private droppedAddsTimers: Map<string, NodeJS.Timeout> = new Map();

  constructor(
    dataPath: string,
    deps: FileWatcherDeps,
    options: FileWatcherOptions
  ) {
    this.dataPath = dataPath;
    this.recentWrites = deps.recentWrites;
    this.logger = deps.logger;
    this.debounceMs = options.debounceMs ?? 300;
    this.onFileChange = options.onFileChange;
    this.onError = options.onError;
  }

  /**
   * Get the current watcher state.
   */
  getState(): FileWatcherState {
    return this.state;
  }

  /**
   * Start watching the data directory.
   * @throws Error if called from invalid state (not 'idle' or 'stopped')
   */
  start(): void {
    if (this.state !== 'idle' && this.state !== 'stopped') {
      throw new Error(`Cannot start FileWatcher from state '${this.state}'`);
    }

    this.state = 'starting';

    this.watcher = chokidar.watch(this.dataPath, {
      persistent: true,
      ignoreInitial: true,
      ignored: [
        // Quarantine directory
        '**/.quarantine/**',
        // Temp files from AtomicWriter
        '**/*.tmp.*',
        // Inbox files
        '**/inbox.txt',
        '**/inbox-processed.txt',
        // Obsidian projection directory
        '**/obsidian/**',
      ],
      // Use polling on some systems for reliability
      usePolling: false,
      // Stabilize events
      awaitWriteFinish: false,
    });

    this.watcher.on('add', (filePath) => this.handleEvent(filePath, 'add'));
    this.watcher.on('change', (filePath) => this.handleEvent(filePath, 'change'));
    this.watcher.on('unlink', (filePath) => this.handleEvent(filePath, 'unlink'));

    this.watcher.on('error', (err) => {
      this.logger.error('fileWatcher.error', 'Chokidar error', {
        error: err.message,
      });
      this.onError(err);
    });

    this.watcher.on('ready', () => {
      this.state = 'running';
      this.logger.debug('fileWatcher.ready', 'File watcher ready', {
        dataPath: this.dataPath,
      });
    });
  }

  /**
   * Stop watching and clean up.
   * No-op if already 'idle' or 'stopped'.
   * @returns Promise that resolves when watcher is fully closed
   */
  async stop(): Promise<void> {
    if (this.state === 'idle' || this.state === 'stopped') {
      return;
    }

    if (this.state === 'starting') {
      // Wait for start to complete before stopping
      await new Promise<void>((resolve) => {
        const check = setInterval(() => {
          if (this.state === 'running') {
            clearInterval(check);
            resolve();
          }
        }, 10);
      });
      // Now proceed with normal stop
    }

    if (this.state === 'stopping') {
      // Already stopping, wait for it with a safety timeout
      // (5 seconds should be more than enough for chokidar to close)
      return new Promise((resolve) => {
        const startTime = Date.now();
        const check = setInterval(() => {
          if (this.state === 'stopped') {
            clearInterval(check);
            resolve();
          } else if (Date.now() - startTime > 5000) {
            // Safety timeout: resolve anyway after 5 seconds
            clearInterval(check);
            this.logger.warn('fileWatcher.stopTimeout', 'Stop timed out waiting for stopped state, resolving anyway');
            resolve();
          }
        }, 10);
      });
    }

    this.state = 'stopping';

    // Cancel all pending debounced events
    for (const pending of this.pendingEvents.values()) {
      clearTimeout(pending.timer);
    }
    this.pendingEvents.clear();

    // Cancel all droppedAdds cleanup timers
    for (const timer of this.droppedAddsTimers.values()) {
      clearTimeout(timer);
    }
    this.droppedAddsTimers.clear();
    this.droppedAdds.clear();

    // Close the watcher
    if (this.watcher) {
      await this.watcher.close();
      this.watcher = null;
    }

    this.state = 'stopped';
    this.logger.debug('fileWatcher.stopped', 'File watcher stopped');
  }

  /**
   * Handle a raw file event from chokidar.
   * Applies self-write suppression and debouncing.
   */
  private handleEvent(filePath: string, event: FileWatcherEvent): void {
    const absolutePath = path.resolve(filePath);

    // Self-write suppression: check if this was a recent internal write
    if (this.recentWrites.wasRecentlyWritten(absolutePath)) {
      this.logger.debug('fileWatcher.suppressed', 'Suppressed self-write event', {
        path: absolutePath,
        event,
      });
      return;
    }

    // Check for pending event on this path
    const existing = this.pendingEvents.get(absolutePath);
    if (existing) {
      clearTimeout(existing.timer);

      // Special case: unlink after pending add means the file never existed
      // from the caller's perspective. Cancel the add and don't queue the unlink.
      if (existing.event === 'add' && event === 'unlink') {
        this.pendingEvents.delete(absolutePath);
        this.logger.debug('fileWatcher.cancelled', 'Cancelled add event due to immediate unlink', {
          path: absolutePath,
        });
        return;
      }
    }

    // Set up new debounced event
    const timer = setTimeout(() => {
      this.deliverEvent(absolutePath, event);
    }, this.debounceMs);

    this.pendingEvents.set(absolutePath, {
      absolutePath,
      event,
      timer,
    });

    this.logger.debug('fileWatcher.debouncing', 'Debouncing event', {
      path: absolutePath,
      event,
      debounceMs: this.debounceMs,
    });
  }

  /**
   * Deliver a debounced event to the callback.
   * For add/change events, verifies file still exists before delivery.
   */
  private async deliverEvent(absolutePath: string, event: FileWatcherEvent): Promise<void> {
    // Remove from pending
    this.pendingEvents.delete(absolutePath);

    // For unlink events, check if this path had a recently dropped add
    // (file was created and deleted before we could notify - treat as never existed)
    if (event === 'unlink') {
      const droppedAt = this.droppedAdds.get(absolutePath);
      if (droppedAt !== undefined) {
        const age = Date.now() - droppedAt;
        this.droppedAdds.delete(absolutePath);
        // Cancel the cleanup timer since we consumed the entry
        const timer = this.droppedAddsTimers.get(absolutePath);
        if (timer) {
          clearTimeout(timer);
          this.droppedAddsTimers.delete(absolutePath);
        }
        if (age < DROPPED_ADD_TTL_MS) {
          this.logger.debug('fileWatcher.suppressed', 'Suppressed unlink for dropped add', {
            path: absolutePath,
          });
          return;
        }
      }
    }

    // For add/change events, verify file still exists
    if (event === 'add' || event === 'change') {
      try {
        await access(absolutePath);
      } catch {
        // File no longer exists, drop the event silently
        this.logger.debug('fileWatcher.dropped', 'Dropped event for deleted file', {
          path: absolutePath,
          event,
        });
        // Track this dropped add so we can suppress the subsequent unlink
        if (event === 'add') {
          this.droppedAdds.set(absolutePath, Date.now());
          // Schedule auto-cleanup in case the unlink never arrives
          const cleanupTimer = setTimeout(() => {
            this.droppedAdds.delete(absolutePath);
            this.droppedAddsTimers.delete(absolutePath);
          }, DROPPED_ADD_TTL_MS);
          this.droppedAddsTimers.set(absolutePath, cleanupTimer);
        }
        return;
      }
    }

    // Deliver the event
    this.logger.debug('fileWatcher.delivering', 'Delivering file event', {
      path: absolutePath,
      event,
    });

    try {
      await this.onFileChange(absolutePath, event);
    } catch (err) {
      this.logger.error('fileWatcher.callbackError', 'Error in onFileChange callback', {
        path: absolutePath,
        event,
        error: (err as Error).message,
      });
    }
  }
}
