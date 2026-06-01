import { describe, it, expect } from 'vitest';
import {
  AppError,
  AppErrorOptions,
  ValidationError,
  StorageError,
  NetworkError,
  QuarantineError,
} from './errors.js';

describe('AppError', () => {
  describe('constructor', () => {
    it('sets all properties correctly', () => {
      const error = new AppError('Test error', {
        op: 'test.operation',
        context: { foo: 'bar' },
        recoverable: true,
      });

      expect(error.message).toBe('Test error');
      expect(error.op).toBe('test.operation');
      expect(error.context).toEqual({ foo: 'bar' });
      expect(error.recoverable).toBe(true);
      expect(error.name).toBe('AppError');
      expect(error.timestamp).toBeDefined();
      expect(error.stack).toBeDefined();
    });

    it('defaults context to empty object', () => {
      const error = new AppError('Test error', { op: 'test.op' });
      expect(error.context).toEqual({});
    });

    it('defaults recoverable to false', () => {
      const error = new AppError('Test error', { op: 'test.op' });
      expect(error.recoverable).toBe(false);
    });

    it('sets timestamp to ISO 8601 format', () => {
      const before = new Date().toISOString();
      const error = new AppError('Test error', { op: 'test.op' });
      const after = new Date().toISOString();

      // Verify ISO 8601 format
      expect(error.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);

      // Verify timestamp is between before and after
      expect(error.timestamp >= before).toBe(true);
      expect(error.timestamp <= after).toBe(true);
    });

    it('is instanceof Error', () => {
      const error = new AppError('Test error', { op: 'test.op' });
      expect(error instanceof Error).toBe(true);
      expect(error instanceof AppError).toBe(true);
    });
  });

  describe('cause chaining', () => {
    it('preserves original error as cause', () => {
      const originalError = new Error('Original error');
      const error = new AppError('Wrapper error', {
        op: 'test.op',
        cause: originalError,
      });

      expect(error.cause).toBe(originalError);
      expect((error.cause as Error).message).toBe('Original error');
    });

    it('includes cause stack in error chain', () => {
      const originalError = new Error('Original error');
      const error = new AppError('Wrapper error', {
        op: 'test.op',
        cause: originalError,
      });

      // The cause should have its own stack
      expect((error.cause as Error).stack).toBeDefined();
      expect((error.cause as Error).stack).toContain('Original error');
    });

    it('works without cause', () => {
      const error = new AppError('No cause', { op: 'test.op' });
      expect(error.cause).toBeUndefined();
    });
  });

  describe('toJSON()', () => {
    it('returns expected structure', () => {
      const error = new AppError('Test error', {
        op: 'test.operation',
        context: { key: 'value' },
        recoverable: true,
      });

      const json = error.toJSON();

      expect(json).toHaveProperty('ts', error.timestamp);
      expect(json).toHaveProperty('error', 'AppError');
      expect(json).toHaveProperty('message', 'Test error');
      expect(json).toHaveProperty('op', 'test.operation');
      expect(json).toHaveProperty('context', { key: 'value' });
      expect(json).toHaveProperty('recoverable', true);
      expect(json).toHaveProperty('stack');
    });

    it('is JSON serializable', () => {
      const error = new AppError('Test error', {
        op: 'test.op',
        context: { nested: { deep: true } },
      });

      const serialized = JSON.stringify(error.toJSON());
      const parsed = JSON.parse(serialized);

      expect(parsed.message).toBe('Test error');
      expect(parsed.context.nested.deep).toBe(true);
    });
  });

  describe('toDebugBlock()', () => {
    it('starts with correct delimiter', () => {
      const error = new AppError('Test error', { op: 'test.op' });
      const block = error.toDebugBlock();
      expect(block.startsWith('--- DEBUG BLOCK ---')).toBe(true);
    });

    it('ends with correct delimiter', () => {
      const error = new AppError('Test error', { op: 'test.op' });
      const block = error.toDebugBlock();
      expect(block.endsWith('--- END DEBUG BLOCK ---')).toBe(true);
    });

    it('contains valid JSON between delimiters', () => {
      const error = new AppError('Test error', {
        op: 'test.op',
        context: { foo: 'bar' },
      });
      const block = error.toDebugBlock();

      // Extract JSON from between delimiters
      const match = block.match(/--- DEBUG BLOCK ---\n([\s\S]*)\n--- END DEBUG BLOCK ---/);
      expect(match).not.toBeNull();

      const jsonStr = match![1];
      expect(() => JSON.parse(jsonStr)).not.toThrow();
    });

    it('parsed object has all required fields', () => {
      const error = new AppError('Test error', {
        op: 'test.op',
        context: { foo: 'bar' },
      });
      const block = error.toDebugBlock();

      const match = block.match(/--- DEBUG BLOCK ---\n([\s\S]*)\n--- END DEBUG BLOCK ---/);
      const parsed = JSON.parse(match![1]);

      expect(parsed).toHaveProperty('ts');
      expect(parsed).toHaveProperty('error');
      expect(parsed).toHaveProperty('message');
      expect(parsed).toHaveProperty('op');
      expect(parsed).toHaveProperty('context');
      expect(parsed).toHaveProperty('stack');
    });

    it('ts matches ISO 8601 format', () => {
      const error = new AppError('Test error', { op: 'test.op' });
      const block = error.toDebugBlock();

      const match = block.match(/--- DEBUG BLOCK ---\n([\s\S]*)\n--- END DEBUG BLOCK ---/);
      const parsed = JSON.parse(match![1]);

      expect(parsed.ts).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
    });

    it('error equals the error class name', () => {
      const error = new AppError('Test error', { op: 'test.op' });
      const block = error.toDebugBlock();

      const match = block.match(/--- DEBUG BLOCK ---\n([\s\S]*)\n--- END DEBUG BLOCK ---/);
      const parsed = JSON.parse(match![1]);

      expect(parsed.error).toBe('AppError');
    });
  });
});

describe('ValidationError', () => {
  it('extends AppError', () => {
    const error = new ValidationError('Invalid input', { op: 'validate' });
    expect(error instanceof AppError).toBe(true);
    expect(error instanceof ValidationError).toBe(true);
  });

  it('locks recoverable to false', () => {
    const error = new ValidationError('Invalid input', { op: 'validate' });
    expect(error.recoverable).toBe(false);
  });

  it('ignores recoverable even if passed via type escape', () => {
    // Cast to any to bypass type checking - verifies runtime behavior
    // TypeScript prevents this at compile time; this tests the runtime lock
    const error = new ValidationError('Invalid input', {
      op: 'validate',
      recoverable: true,
    } as Omit<AppErrorOptions, 'recoverable'>);
    expect(error.recoverable).toBe(false);
  });

  it('sets name to ValidationError', () => {
    const error = new ValidationError('Invalid input', { op: 'validate' });
    expect(error.name).toBe('ValidationError');
  });

  it('toDebugBlock error field equals class name', () => {
    const error = new ValidationError('Invalid input', { op: 'validate' });
    const block = error.toDebugBlock();

    const match = block.match(/--- DEBUG BLOCK ---\n([\s\S]*)\n--- END DEBUG BLOCK ---/);
    const parsed = JSON.parse(match![1]);

    expect(parsed.error).toBe('ValidationError');
  });
});

describe('StorageError', () => {
  it('extends AppError', () => {
    const error = new StorageError('Disk full', { op: 'fileStore.save' });
    expect(error instanceof AppError).toBe(true);
    expect(error instanceof StorageError).toBe(true);
  });

  it('locks recoverable to false', () => {
    const error = new StorageError('Disk full', { op: 'fileStore.save' });
    expect(error.recoverable).toBe(false);
  });

  it('ignores recoverable even if passed via type escape', () => {
    // Cast to bypass type checking - verifies runtime behavior
    // TypeScript prevents this at compile time; this tests the runtime lock
    const error = new StorageError('Disk full', {
      op: 'fileStore.save',
      recoverable: true,
    } as Omit<AppErrorOptions, 'recoverable'>);
    expect(error.recoverable).toBe(false);
  });

  it('sets name to StorageError', () => {
    const error = new StorageError('Disk full', { op: 'fileStore.save' });
    expect(error.name).toBe('StorageError');
  });

  it('toDebugBlock error field equals class name', () => {
    const error = new StorageError('Disk full', { op: 'fileStore.save' });
    const block = error.toDebugBlock();

    const match = block.match(/--- DEBUG BLOCK ---\n([\s\S]*)\n--- END DEBUG BLOCK ---/);
    const parsed = JSON.parse(match![1]);

    expect(parsed.error).toBe('StorageError');
  });
});

describe('NetworkError', () => {
  it('extends AppError', () => {
    const error = new NetworkError('Connection refused', { op: 'api.fetch' });
    expect(error instanceof AppError).toBe(true);
    expect(error instanceof NetworkError).toBe(true);
  });

  it('locks recoverable to true', () => {
    const error = new NetworkError('Connection refused', { op: 'api.fetch' });
    expect(error.recoverable).toBe(true);
  });

  it('ignores recoverable even if passed via type escape', () => {
    // Cast to bypass type checking - verifies runtime behavior
    // TypeScript prevents this at compile time; this tests the runtime lock
    const error = new NetworkError('Connection refused', {
      op: 'api.fetch',
      recoverable: false,
    } as Omit<AppErrorOptions, 'recoverable'>);
    expect(error.recoverable).toBe(true);
  });

  it('sets name to NetworkError', () => {
    const error = new NetworkError('Connection refused', { op: 'api.fetch' });
    expect(error.name).toBe('NetworkError');
  });

  it('toDebugBlock error field equals class name', () => {
    const error = new NetworkError('Connection refused', { op: 'api.fetch' });
    const block = error.toDebugBlock();

    const match = block.match(/--- DEBUG BLOCK ---\n([\s\S]*)\n--- END DEBUG BLOCK ---/);
    const parsed = JSON.parse(match![1]);

    expect(parsed.error).toBe('NetworkError');
  });
});

describe('QuarantineError', () => {
  it('extends AppError', () => {
    const error = new QuarantineError('File quarantined', { op: 'fileStore.get' });
    expect(error instanceof AppError).toBe(true);
    expect(error instanceof QuarantineError).toBe(true);
  });

  it('locks recoverable to false', () => {
    const error = new QuarantineError('File quarantined', { op: 'fileStore.get' });
    expect(error.recoverable).toBe(false);
  });

  it('ignores recoverable even if passed via type escape', () => {
    // Cast to bypass type checking - verifies runtime behavior
    // TypeScript prevents this at compile time; this tests the runtime lock
    const error = new QuarantineError('File quarantined', {
      op: 'fileStore.get',
      recoverable: true,
    } as Omit<AppErrorOptions, 'recoverable'>);
    expect(error.recoverable).toBe(false);
  });

  it('sets name to QuarantineError', () => {
    const error = new QuarantineError('File quarantined', { op: 'fileStore.get' });
    expect(error.name).toBe('QuarantineError');
  });

  it('toDebugBlock error field equals class name', () => {
    const error = new QuarantineError('File quarantined', { op: 'fileStore.get' });
    const block = error.toDebugBlock();

    const match = block.match(/--- DEBUG BLOCK ---\n([\s\S]*)\n--- END DEBUG BLOCK ---/);
    const parsed = JSON.parse(match![1]);

    expect(parsed.error).toBe('QuarantineError');
  });
});
