/**
 * RecentWrites tracks files recently written by the app to enable
 * self-write suppression in the FileWatcher. When AtomicWriter completes
 * a write, it records the path here. The FileWatcher checks this map
 * before processing events to avoid redundant re-reads of files we just wrote.
 *
 * TTL: 500ms (entries expire after this window)
 */

const TTL_MS = 500;

export interface RecentWrites {
  /** Called by AtomicWriter after successful write */
  record(absolutePath: string): void;
  /** Called by FileWatcher; returns true if path was written within last 500ms */
  wasRecentlyWritten(absolutePath: string): boolean;
}

export function createRecentWrites(): RecentWrites {
  const writes = new Map<string, number>();

  function pruneExpired(): void {
    const now = Date.now();
    for (const [path, timestamp] of writes) {
      if (now - timestamp > TTL_MS) {
        writes.delete(path);
      }
    }
  }

  return {
    record(absolutePath: string): void {
      writes.set(absolutePath, Date.now());
      // Prune expired entries lazily to prevent unbounded growth
      pruneExpired();
    },

    wasRecentlyWritten(absolutePath: string): boolean {
      const timestamp = writes.get(absolutePath);
      if (timestamp === undefined) {
        return false;
      }
      const age = Date.now() - timestamp;
      if (age > TTL_MS) {
        // Expired; clean it up
        writes.delete(absolutePath);
        return false;
      }
      return true;
    },
  };
}
