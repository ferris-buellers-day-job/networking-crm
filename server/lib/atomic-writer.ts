import { open, rename, unlink } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import path from 'node:path';
import type { RecentWrites } from './recent-writes.js';

/**
 * Recursively sorts object keys alphabetically for stable JSON output.
 * Arrays are preserved in order; only object keys are sorted.
 */
function sortKeys(value: unknown): unknown {
  if (value === null || typeof value !== 'object') {
    return value;
  }

  if (Array.isArray(value)) {
    return value.map(sortKeys);
  }

  const sorted: Record<string, unknown> = {};
  const keys = Object.keys(value as Record<string, unknown>).sort();
  for (const key of keys) {
    sorted[key] = sortKeys((value as Record<string, unknown>)[key]);
  }
  return sorted;
}

/**
 * Atomically writes JSON data to a file using the write-temp-then-rename pattern.
 *
 * Per ADR 007:
 * - Serializes JSON with stable key ordering (alphabetical) and trailing newline
 * - Writes to a sibling temp file (<path>.tmp.<randomId>)
 * - Calls fsync to force bytes to disk
 * - Uses rename to atomically replace the target file
 * - On any error, cleans up the temp file and throws
 * - After successful rename, records the path in recentWrites for self-write suppression
 *
 * @param filePath - Target file path (will be created or overwritten)
 * @param data - Data to serialize as JSON
 * @param recentWrites - RecentWrites instance to record successful writes
 * @throws Error if parent directory doesn't exist or write fails
 */
export async function atomicWriteJson(
  filePath: string,
  data: unknown,
  recentWrites: RecentWrites
): Promise<void> {
  const absolutePath = path.resolve(filePath);
  const randomSuffix = randomBytes(8).toString('hex');
  const tempPath = `${absolutePath}.tmp.${randomSuffix}`;

  // Serialize with sorted keys and trailing newline
  const sortedData = sortKeys(data);
  const content = JSON.stringify(sortedData, null, 2) + '\n';

  let fileHandle;
  try {
    // Open file for writing (create if not exists, truncate if exists)
    // This will throw if parent directory doesn't exist
    fileHandle = await open(tempPath, 'w');

    // Write content
    await fileHandle.writeFile(content, 'utf-8');

    // Force bytes to disk via fsync
    await fileHandle.datasync();

    // Close file before rename
    await fileHandle.close();
    fileHandle = undefined;

    // Atomically replace target file
    await rename(tempPath, absolutePath);

    // Record successful write for self-write suppression
    recentWrites.record(absolutePath);
  } catch (error) {
    // Clean up temp file if it exists
    if (fileHandle) {
      try {
        await fileHandle.close();
      } catch {
        // Ignore close errors during cleanup
      }
    }
    try {
      await unlink(tempPath);
    } catch {
      // Ignore unlink errors (file may not exist)
    }
    throw error;
  }
}
