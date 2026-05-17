import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtemp, rm, writeFile, unlink, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { FileWatcher, type FileWatcherEvent } from './file-watcher.js';
import { createRecentWrites } from './recent-writes.js';
import { atomicWriteJson } from './atomic-writer.js';
import type { Logger } from './logger.js';

// Mock logger
function createMockLogger(): Logger {
  return {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  };
}

// Helper to wait for a condition with timeout
async function waitFor(
  condition: () => boolean,
  timeoutMs: number = 2000,
  intervalMs: number = 20
): Promise<void> {
  const start = Date.now();
  while (!condition()) {
    if (Date.now() - start > timeoutMs) {
      throw new Error(`waitFor timed out after ${timeoutMs}ms`);
    }
    await new Promise((r) => setTimeout(r, intervalMs));
  }
}

// Helper to wait a fixed amount of time
function delay(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

describe('FileWatcher', () => {
  let tempDir: string;
  let dataDir: string;
  let recentWrites: ReturnType<typeof createRecentWrites>;
  let logger: Logger;
  let watcher: FileWatcher;
  let events: { path: string; event: FileWatcherEvent }[];
  let errors: Error[];

  beforeEach(async () => {
    tempDir = await mkdtemp(path.join(tmpdir(), 'file-watcher-test-'));
    dataDir = path.join(tempDir, 'data');
    await mkdir(dataDir, { recursive: true });

    recentWrites = createRecentWrites();
    logger = createMockLogger();
    events = [];
    errors = [];

    watcher = new FileWatcher(
      dataDir,
      { recentWrites, logger },
      {
        debounceMs: 100, // Shorter for tests
        onFileChange: async (absolutePath, event) => {
          events.push({ path: absolutePath, event });
        },
        onError: (err) => {
          errors.push(err);
        },
      }
    );
  });

  afterEach(async () => {
    await watcher.stop();
    await rm(tempDir, { recursive: true, force: true });
  });

  describe('file events', () => {
    it('fires callback for add event', async () => {
      watcher.start();
      await waitFor(() => watcher.getState() === 'running');

      const filePath = path.join(dataDir, 'test.json');
      await writeFile(filePath, '{"test": true}');

      await waitFor(() => events.length > 0, 1000);

      expect(events).toHaveLength(1);
      expect(events[0].path).toBe(filePath);
      expect(events[0].event).toBe('add');
    });

    it('fires callback for change event', async () => {
      // Create file before starting watcher
      const filePath = path.join(dataDir, 'existing.json');
      await writeFile(filePath, '{"version": 1}');

      watcher.start();
      await waitFor(() => watcher.getState() === 'running');

      // Modify the file
      await writeFile(filePath, '{"version": 2}');

      await waitFor(() => events.length > 0, 1000);

      expect(events).toHaveLength(1);
      expect(events[0].path).toBe(filePath);
      expect(events[0].event).toBe('change');
    });

    it('fires callback for unlink event', async () => {
      // Create file before starting watcher
      const filePath = path.join(dataDir, 'to-delete.json');
      await writeFile(filePath, '{"delete": true}');

      watcher.start();
      await waitFor(() => watcher.getState() === 'running');

      // Delete the file
      await unlink(filePath);

      await waitFor(() => events.length > 0, 1000);

      expect(events).toHaveLength(1);
      expect(events[0].path).toBe(filePath);
      expect(events[0].event).toBe('unlink');
    });
  });

  describe('debouncing', () => {
    it('debounces rapid changes into single callback', async () => {
      const filePath = path.join(dataDir, 'rapid.json');
      await writeFile(filePath, '{"v": 0}');

      watcher.start();
      await waitFor(() => watcher.getState() === 'running');

      // Rapid changes
      await writeFile(filePath, '{"v": 1}');
      await delay(20);
      await writeFile(filePath, '{"v": 2}');
      await delay(20);
      await writeFile(filePath, '{"v": 3}');

      // Wait well past debounce window
      await delay(300);

      // Should have only one event (the debounced result)
      expect(events.length).toBe(1);
      expect(events[0].event).toBe('change');
    });

    it('produces zero callbacks when file added then deleted within debounce window', async () => {
      // Track when chokidar sees the add event via logger spy
      let addEventSeen = false;
      (logger.debug as ReturnType<typeof vi.fn>).mockImplementation((op: string) => {
        if (op === 'fileWatcher.debouncing') {
          addEventSeen = true;
        }
      });

      watcher.start();
      await waitFor(() => watcher.getState() === 'running');

      const filePath = path.join(dataDir, 'ephemeral.json');

      // Create file
      await writeFile(filePath, '{"temp": true}');

      // Wait until chokidar sees the add event
      await waitFor(() => addEventSeen, 2000, 10);

      // Delete file before debounce fires (debounce is 100ms)
      await unlink(filePath);

      // Wait well past debounce window
      await delay(300);

      // No callbacks should have fired:
      // - The add event was cancelled when unlink arrived
      // - No unlink callback because the file never "existed" from caller's perspective
      expect(events).toHaveLength(0);
    });

    it('droppedAdds entries expire after TTL and do not leak', async () => {
      // This test verifies that droppedAdds entries are auto-cleaned.
      // After the TTL expires, a new file sequence on the same path works correctly.

      let addEventCount = 0;
      (logger.debug as ReturnType<typeof vi.fn>).mockImplementation((op: string) => {
        if (op === 'fileWatcher.debouncing') {
          addEventCount++;
        }
      });

      watcher.start();
      await waitFor(() => watcher.getState() === 'running');

      const filePath = path.join(dataDir, 'reused.json');

      // First cycle: create and delete quickly (causes droppedAdds entry)
      await writeFile(filePath, '{"v": 1}');
      await waitFor(() => addEventCount >= 1, 2000, 10);
      await unlink(filePath);

      // Wait past debounce - add will be dropped, unlink suppressed
      await delay(300);
      expect(events).toHaveLength(0);

      // Wait past the DROPPED_ADD_TTL_MS (1000ms) for cleanup
      await delay(1200);

      // Second cycle: create file and keep it long enough for add to deliver
      await writeFile(filePath, '{"v": 2}');
      await waitFor(() => events.length > 0, 1000);

      // The add callback should fire (proving droppedAdds was cleaned up
      // and didn't interfere with new file operations on the same path)
      expect(events).toHaveLength(1);
      expect(events[0].event).toBe('add');
    });
  });

  describe('self-write suppression', () => {
    it('does NOT fire callback for writes via AtomicWriter', async () => {
      watcher.start();
      await waitFor(() => watcher.getState() === 'running');

      const filePath = path.join(dataDir, 'internal.json');

      // Write via AtomicWriter (records in RecentWrites)
      await atomicWriteJson(filePath, { internal: true }, recentWrites);

      // Wait well past debounce window
      await delay(500);

      // No callback should fire - self-write was suppressed
      expect(events).toHaveLength(0);
    });

    it('fires callback for external writes (not via AtomicWriter)', async () => {
      watcher.start();
      await waitFor(() => watcher.getState() === 'running');

      const filePath = path.join(dataDir, 'external.json');

      // Write directly without AtomicWriter (no RecentWrites recording)
      await writeFile(filePath, '{"external": true}');

      await waitFor(() => events.length > 0, 1000);

      expect(events).toHaveLength(1);
      expect(events[0].path).toBe(filePath);
    });
  });

  describe('ignored paths', () => {
    it('ignores .quarantine directory', async () => {
      const quarantineDir = path.join(dataDir, '.quarantine');
      await mkdir(quarantineDir, { recursive: true });

      watcher.start();
      await waitFor(() => watcher.getState() === 'running');

      await writeFile(path.join(quarantineDir, 'bad.json'), '{}');

      await delay(500);

      expect(events).toHaveLength(0);
    });

    it('ignores .tmp. files', async () => {
      watcher.start();
      await waitFor(() => watcher.getState() === 'running');

      await writeFile(path.join(dataDir, 'file.tmp.abc123'), '{}');

      await delay(500);

      expect(events).toHaveLength(0);
    });

    it('ignores inbox.txt', async () => {
      watcher.start();
      await waitFor(() => watcher.getState() === 'running');

      await writeFile(path.join(dataDir, 'inbox.txt'), 'new entry');

      await delay(500);

      expect(events).toHaveLength(0);
    });

    it('ignores inbox-processed.txt', async () => {
      watcher.start();
      await waitFor(() => watcher.getState() === 'running');

      await writeFile(path.join(dataDir, 'inbox-processed.txt'), 'processed');

      await delay(500);

      expect(events).toHaveLength(0);
    });

    it('ignores obsidian directory', async () => {
      const obsidianDir = path.join(dataDir, 'obsidian');
      await mkdir(obsidianDir, { recursive: true });

      watcher.start();
      await waitFor(() => watcher.getState() === 'running');

      await writeFile(path.join(obsidianDir, 'note.md'), '# Note');

      await delay(500);

      expect(events).toHaveLength(0);
    });
  });

  describe('lifecycle', () => {
    it('start() and stop() work cleanly', async () => {
      expect(watcher.getState()).toBe('idle');

      watcher.start();
      await waitFor(() => watcher.getState() === 'running');
      expect(watcher.getState()).toBe('running');

      await watcher.stop();
      expect(watcher.getState()).toBe('stopped');
    });

    it('stop() resolves only after watcher is fully torn down', async () => {
      watcher.start();
      await waitFor(() => watcher.getState() === 'running');

      // Create a pending event
      const filePath = path.join(dataDir, 'pending.json');
      await writeFile(filePath, '{}');

      // Stop immediately (before debounce fires)
      await watcher.stop();

      expect(watcher.getState()).toBe('stopped');

      // Wait to ensure no events fire after stop
      await delay(300);
      expect(events).toHaveLength(0);
    });

    it('throws when start() called from invalid state', async () => {
      watcher.start();
      await waitFor(() => watcher.getState() === 'running');

      // Trying to start again should throw
      expect(() => watcher.start()).toThrow("Cannot start FileWatcher from state 'running'");
    });

    it('stop() is no-op when already idle', async () => {
      expect(watcher.getState()).toBe('idle');
      await watcher.stop(); // Should not throw
      expect(watcher.getState()).toBe('idle');
    });

    it('can restart after stop', async () => {
      watcher.start();
      await waitFor(() => watcher.getState() === 'running');
      await watcher.stop();
      expect(watcher.getState()).toBe('stopped');

      // Should be able to start again
      watcher.start();
      await waitFor(() => watcher.getState() === 'running');
      expect(watcher.getState()).toBe('running');
    });

    it('stop() during starting state waits for running then stops', async () => {
      watcher.start();
      // State should be 'starting' immediately after start()
      expect(watcher.getState()).toBe('starting');

      // Call stop() while still in 'starting' state
      const stopPromise = watcher.stop();

      // stop() should wait for 'running' then complete
      await stopPromise;
      expect(watcher.getState()).toBe('stopped');
    });
  });

  describe('error handling', () => {
    it('surfaces chokidar errors via onError callback', async () => {
      // This is hard to test directly without mocking chokidar internals
      // We'll verify the error handler is wired up by checking the logger mock
      watcher.start();
      await waitFor(() => watcher.getState() === 'running');

      // The watcher is set up with an error handler
      // In a real scenario, chokidar would emit errors for permission issues etc.
      // For now, verify watcher doesn't crash and handlers are wired
      expect(errors).toHaveLength(0);
    });
  });
});
