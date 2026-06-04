/**
 * Error thrown when the API returns a non-2xx response.
 * Carries the error details from the server's ApiErrorResponse format.
 */
export class ApiError extends Error {
  readonly type: string;
  readonly statusCode: number;
  readonly debugBlock: string;

  constructor(
    message: string,
    options: {
      type: string;
      statusCode: number;
      debugBlock: string;
    }
  ) {
    super(message);
    this.name = 'ApiError';
    this.type = options.type;
    this.statusCode = options.statusCode;
    this.debugBlock = options.debugBlock;
  }
}

/**
 * Error thrown when fetch itself fails (network error, DNS failure, etc.).
 * Indicates the request never reached the server or no response was received.
 */
export class NetworkError extends Error {
  readonly cause?: Error;

  constructor(message: string, cause?: Error) {
    super(message);
    this.name = 'NetworkError';
    this.cause = cause;
  }

  /**
   * Generate a debug block for client-side network errors.
   */
  toDebugBlock(): string {
    const data = {
      ts: new Date().toISOString(),
      error: 'NetworkError',
      message: this.message,
      cause: this.cause?.message,
    };
    return `--- DEBUG BLOCK ---\n${JSON.stringify(data, null, 2)}\n--- END DEBUG BLOCK ---`;
  }
}
