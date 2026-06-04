import type { ErrorRequestHandler } from 'express';
import {
  AppError,
  ValidationError,
  QuarantineError,
  StorageError,
  NetworkError,
} from '../lib/errors.js';
import type { Logger } from '../lib/logger.js';

/**
 * API error response format per ADR 010.
 */
export interface ApiErrorResponse {
  error: {
    type: string;
    message: string;
    debugBlock: string;
  };
}

/**
 * Determine HTTP status code from error type.
 */
function getStatusCode(error: AppError): number {
  if (error instanceof ValidationError) {
    return 400;
  }
  if (error instanceof QuarantineError) {
    return 422;
  }
  if (error instanceof StorageError) {
    return 500;
  }
  if (error instanceof NetworkError) {
    // NetworkError shouldn't appear server-side; treat as unexpected
    return 500;
  }
  // Generic AppError or unknown wrapped error
  return 500;
}

/**
 * Create Express error handling middleware.
 *
 * Catches all errors from route handlers and converts them to
 * consistent ApiErrorResponse format with debug blocks.
 *
 * @param logger - Logger instance for recording errors
 */
export function createErrorHandler(logger: Logger): ErrorRequestHandler {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  return (err: unknown, req, res, next) => {
    // If headers already sent, delegate to Express's default handler
    // to close the connection properly
    if (res.headersSent) {
      return next(err);
    }

    try {
      // Wrap non-AppError in a generic AppError
      const appError =
        err instanceof AppError
          ? err
          : new AppError(
              err instanceof Error ? err.message : 'An unexpected error occurred',
              {
                op: 'server.unhandledError',
                context: {
                  originalError: err instanceof Error ? err.name : typeof err,
                },
                cause: err instanceof Error ? err : undefined,
              }
            );

      const statusCode = getStatusCode(appError);

      // Log the error
      logger.error(appError.op, appError.message, {
        type: appError.name,
        statusCode,
        context: appError.context,
        stack: appError.stack,
      });

      // Build response
      const response: ApiErrorResponse = {
        error: {
          type: appError.name,
          message: appError.message,
          debugBlock: appError.toDebugBlock(),
        },
      };

      res.status(statusCode).json(response);
    } catch (handlerError) {
      // The error handler itself threw — this is a last-resort safety net.
      // Log to stderr (not logger, which might also fail) and delegate
      // to Express's default handler to close the connection.
      console.error('Error handler failed:', handlerError);
      console.error('Original error:', err);
      // If headers not yet sent, send a minimal plain-text fallback
      // so the client gets something in roughly the expected shape.
      if (!res.headersSent) {
        try {
          res.status(500).send('Internal server error — see server logs.');
          return;
        } catch {
          // Even plain-text send failed; delegate.
        }
      }
      next(err);
    }
  };
}
