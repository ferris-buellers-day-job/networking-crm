import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, readFile, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { atomicWriteJson } from './atomic-writer.js';
import { createRecentWrites } from './recent-writes.js';

describe('atomicWriteJson', () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(path.join(tmpdir(), 'atomic-writer-test-'));
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it('creates a valid JSON file', async () => {
    const recentWrites = createRecentWrites();
    const filePath = path.join(tempDir, 'test.json');
    const data = { name: 'Test', value: 42 };

    await atomicWriteJson(filePath, data, recentWrites);

    const content = await readFile(filePath, 'utf-8');
    const parsed = JSON.parse(content);
    expect(parsed).toEqual(data);
  });

  it('outputs JSON with keys sorted alphabetically', async () => {
    const recentWrites = createRecentWrites();
    const filePath = path.join(tempDir, 'sorted.json');
    const data = { zebra: 1, apple: 2, mango: 3 };

    await atomicWriteJson(filePath, data, recentWrites);

    const content = await readFile(filePath, 'utf-8');
    // Keys should appear in order: apple, mango, zebra
    const keyOrder = content.match(/"(\w+)":/g)?.map((m) => m.slice(1, -2));
    expect(keyOrder).toEqual(['apple', 'mango', 'zebra']);
  });

  it('sorts nested object keys recursively', async () => {
    const recentWrites = createRecentWrites();
    const filePath = path.join(tempDir, 'nested.json');
    const data = {
      z: { c: 1, a: 2, b: 3 },
      a: { z: 1, y: 2 },
    };

    await atomicWriteJson(filePath, data, recentWrites);

    const content = await readFile(filePath, 'utf-8');
    const parsed = JSON.parse(content);
    // Verify data integrity
    expect(parsed).toEqual(data);
    // Verify key order in output
    expect(content.indexOf('"a"')).toBeLessThan(content.indexOf('"z"'));
  });

  it('preserves array order while sorting object keys', async () => {
    const recentWrites = createRecentWrites();
    const filePath = path.join(tempDir, 'array.json');
    const data = {
      items: [
        { z: 1, a: 2 },
        { b: 3, a: 4 },
      ],
    };

    await atomicWriteJson(filePath, data, recentWrites);

    const content = await readFile(filePath, 'utf-8');
    const parsed = JSON.parse(content);
    expect(parsed.items[0]).toEqual({ z: 1, a: 2 });
    expect(parsed.items[1]).toEqual({ b: 3, a: 4 });
  });

  it('adds trailing newline', async () => {
    const recentWrites = createRecentWrites();
    const filePath = path.join(tempDir, 'newline.json');

    await atomicWriteJson(filePath, { test: true }, recentWrites);

    const content = await readFile(filePath, 'utf-8');
    expect(content.endsWith('\n')).toBe(true);
  });

  it('throws when parent directory does not exist', async () => {
    const recentWrites = createRecentWrites();
    const filePath = path.join(tempDir, 'nonexistent', 'nested', 'file.json');

    await expect(atomicWriteJson(filePath, { test: true }, recentWrites)).rejects.toThrow();
  });

  it('does not leave temp files on error', async () => {
    const recentWrites = createRecentWrites();
    const filePath = path.join(tempDir, 'nonexistent', 'file.json');

    try {
      await atomicWriteJson(filePath, { test: true }, recentWrites);
    } catch {
      // Expected to fail
    }

    // Check no temp files left in tempDir
    const files = await readdir(tempDir);
    const tempFiles = files.filter((f) => f.includes('.tmp.'));
    expect(tempFiles).toHaveLength(0);
  });

  it('overwrites existing file atomically', async () => {
    const recentWrites = createRecentWrites();
    const filePath = path.join(tempDir, 'overwrite.json');

    await atomicWriteJson(filePath, { version: 1 }, recentWrites);
    await atomicWriteJson(filePath, { version: 2 }, recentWrites);

    const content = await readFile(filePath, 'utf-8');
    const parsed = JSON.parse(content);
    expect(parsed.version).toBe(2);
  });

  it('concurrent writes do not corrupt the file', async () => {
    const recentWrites = createRecentWrites();
    const filePath = path.join(tempDir, 'concurrent.json');

    // Run multiple concurrent writes
    const writes = Array.from({ length: 10 }, (_, i) =>
      atomicWriteJson(filePath, { index: i }, recentWrites)
    );

    await Promise.all(writes);

    // File should contain valid JSON with one of the indices
    const content = await readFile(filePath, 'utf-8');
    const parsed = JSON.parse(content);
    expect(typeof parsed.index).toBe('number');
    expect(parsed.index).toBeGreaterThanOrEqual(0);
    expect(parsed.index).toBeLessThan(10);
  });

  it('records path in recentWrites after successful write', async () => {
    const recentWrites = createRecentWrites();
    const filePath = path.join(tempDir, 'recorded.json');
    const absolutePath = path.resolve(filePath);

    // Should not be recorded before write
    expect(recentWrites.wasRecentlyWritten(absolutePath)).toBe(false);

    await atomicWriteJson(filePath, { test: true }, recentWrites);

    // Should be recorded after successful write
    expect(recentWrites.wasRecentlyWritten(absolutePath)).toBe(true);
  });

  it('does not record path in recentWrites on failed write', async () => {
    const recentWrites = createRecentWrites();
    const filePath = path.join(tempDir, 'nonexistent', 'failed.json');
    const absolutePath = path.resolve(filePath);

    try {
      await atomicWriteJson(filePath, { test: true }, recentWrites);
    } catch {
      // Expected to fail
    }

    // Should not be recorded after failed write
    expect(recentWrites.wasRecentlyWritten(absolutePath)).toBe(false);
  });

  it('handles null values correctly', async () => {
    const recentWrites = createRecentWrites();
    const filePath = path.join(tempDir, 'null.json');
    const data = { name: 'Test', deletedAt: null };

    await atomicWriteJson(filePath, data, recentWrites);

    const content = await readFile(filePath, 'utf-8');
    const parsed = JSON.parse(content);
    expect(parsed.deletedAt).toBeNull();
  });

  it('handles empty object', async () => {
    const recentWrites = createRecentWrites();
    const filePath = path.join(tempDir, 'empty.json');

    await atomicWriteJson(filePath, {}, recentWrites);

    const content = await readFile(filePath, 'utf-8');
    expect(JSON.parse(content)).toEqual({});
  });

  it('handles deeply nested objects', async () => {
    const recentWrites = createRecentWrites();
    const filePath = path.join(tempDir, 'deep.json');
    const data = {
      level1: {
        level2: {
          level3: {
            value: 'deep',
          },
        },
      },
    };

    await atomicWriteJson(filePath, data, recentWrites);

    const content = await readFile(filePath, 'utf-8');
    const parsed = JSON.parse(content);
    expect(parsed.level1.level2.level3.value).toBe('deep');
  });
});
