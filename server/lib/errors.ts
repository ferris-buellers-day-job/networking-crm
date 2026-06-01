/**
 * Application error hierarchy for the Networking CRM.
 *
 * All application errors extend AppError, which provides:
 * - Structured context for debugging
 * - Copyable debug blocks for Claude Code sessions
 * - Consistent API error response formatting
 *
 * @see docs/decisions/010-debug-error-format.md
 */

export interface AppErrorOptions {
  /** Operation that failed (e.g., "contact.save", "fileStore.get") */
  op: string;
  /** Additional context for debugging */
  context?: Record<string, unknown>;
  /**
   * If true, the operation may be retried by the caller with appropriate backoff.
   * If false, the operation must not be retried; surface to user immediately.
   */
  recoverable?: boolean;
  /** Original error that caused this error */
  cause?: Error;
}

/**
 * Base class for all application errors.
 *
 * @property recoverable - If true, the operation may be retried by the caller
 *   with appropriate backoff (e.g., transient network issues, iCloud sync lag).
 *   If false, the operation must not be retried; surface to user immediately.
 */
export class AppError extends Error {
  readonly op: string;
  readonly context: Record<string, unknown>;
  readonly recoverable: boolean;
  readonly timestamp: string;

  constructor(message: string, options: AppErrorOptions) {
    super(message, { cause: options.cause });
    this.name = this.constructor.name;
    this.op = options.op;
    this.context = options.context ?? {};
    this.recoverable = options.recoverable ?? false;
    this.timestamp = new Date().toISOString();

    // Ensure proper prototype chain for instanceof checks
    Object.setPrototypeOf(this, new.target.prototype);
  }

  /**
   * Generate a copyable debug block for pasting into Claude Code sessions.
   * Format is machine-readable JSON wrapped in delimiters.
   */
  toDebugBlock(): string {
    const json = JSON.stringify(
      {
        ts: this.timestamp,
        error: this.name,
        message: this.message,
        op: this.op,
        context: this.context,
        stack: this.stack ?? '',
      },
      null,
      2
    );
    return `--- DEBUG BLOCK ---\n${json}\n--- END DEBUG BLOCK ---`;
  }

  /**
   * Serialize error for API responses.
   */
  toJSON(): object {
    return {
      ts: this.timestamp,
      error: this.name,
      message: this.message,
      op: this.op,
      context: this.context,
      recoverable: this.recoverable,
      stack: this.stack ?? '',
    };
  }
}

/**
 * Validation error for invalid input data.
 * Not recoverable — invalid data will remain invalid on retry.
 */
export class ValidationError extends AppError {
  override readonly recoverable = false as const;

  constructor(message: string, options: Omit<AppErrorOptions, 'recoverable'>) {
    super(message, { ...options, recoverable: false });
  }
}

/**
 * Storage error for file system or database failures.
 * Not recoverable — storage issues typically require user intervention.
 */
export class StorageError extends AppError {
  override readonly recoverable = false as const;

  constructor(message: string, options: Omit<AppErrorOptions, 'recoverable'>) {
    super(message, { ...options, recoverable: false });
  }
}

/**
 * Network error for transient connectivity issues.
 * Recoverable — network issues may resolve on retry with backoff.
 */
export class NetworkError extends AppError {
  override readonly recoverable = true as const;

  constructor(message: string, options: Omit<AppErrorOptions, 'recoverable'>) {
    super(message, { ...options, recoverable: true });
  }
}

/**
 * Quarantine error when a file fails validation and is quarantined.
 * Not recoverable — file must be manually repaired or deleted.
 */
export class QuarantineError extends AppError {
  override readonly recoverable = false as const;

  constructor(message: string, options: Omit<AppErrorOptions, 'recoverable'>) {
    super(message, { ...options, recoverable: false });
  }
}
