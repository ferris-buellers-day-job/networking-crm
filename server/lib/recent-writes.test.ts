import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createRecentWrites } from './recent-writes.js';

describe('RecentWrites', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('returns false for never-recorded paths', () => {
    const recentWrites = createRecentWrites();
    expect(recentWrites.wasRecentlyWritten('/some/path.json')).toBe(false);
  });

  it('returns true immediately after recording a path', () => {
    const recentWrites = createRecentWrites();
    recentWrites.record('/some/path.json');
    expect(recentWrites.wasRecentlyWritten('/some/path.json')).toBe(true);
  });

  it('returns true within 500ms TTL window', () => {
    const recentWrites = createRecentWrites();
    recentWrites.record('/some/path.json');

    // Advance time by 499ms (still within TTL)
    vi.advanceTimersByTime(499);
    expect(recentWrites.wasRecentlyWritten('/some/path.json')).toBe(true);
  });

  it('returns false after 500ms TTL expires', () => {
    const recentWrites = createRecentWrites();
    recentWrites.record('/some/path.json');

    // Advance time by 501ms (past TTL)
    vi.advanceTimersByTime(501);
    expect(recentWrites.wasRecentlyWritten('/some/path.json')).toBe(false);
  });

  it('tracks multiple paths independently', () => {
    const recentWrites = createRecentWrites();

    recentWrites.record('/path/a.json');
    vi.advanceTimersByTime(200);
    recentWrites.record('/path/b.json');

    // At 200ms: a is 200ms old (valid), b is 0ms old (valid)
    expect(recentWrites.wasRecentlyWritten('/path/a.json')).toBe(true);
    expect(recentWrites.wasRecentlyWritten('/path/b.json')).toBe(true);

    // Advance another 350ms (total 550ms for a, 350ms for b)
    vi.advanceTimersByTime(350);

    // a should be expired (550ms > 500ms), b should still be valid (350ms < 500ms)
    expect(recentWrites.wasRecentlyWritten('/path/a.json')).toBe(false);
    expect(recentWrites.wasRecentlyWritten('/path/b.json')).toBe(true);
  });

  it('updates timestamp when same path is recorded again', () => {
    const recentWrites = createRecentWrites();

    recentWrites.record('/path/a.json');
    vi.advanceTimersByTime(400);

    // Re-record the same path
    recentWrites.record('/path/a.json');

    // Advance another 200ms (total 600ms from first write, 200ms from second)
    vi.advanceTimersByTime(200);

    // Should still be valid because second write reset the timer
    expect(recentWrites.wasRecentlyWritten('/path/a.json')).toBe(true);
  });

  it('prunes expired entries on record()', () => {
    const recentWrites = createRecentWrites();

    recentWrites.record('/path/a.json');
    vi.advanceTimersByTime(600);

    // Recording a new path should prune expired entries
    recentWrites.record('/path/b.json');

    // a should be expired and pruned
    expect(recentWrites.wasRecentlyWritten('/path/a.json')).toBe(false);
    expect(recentWrites.wasRecentlyWritten('/path/b.json')).toBe(true);
  });
});
