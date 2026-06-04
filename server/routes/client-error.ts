import { Router } from 'express';
import type { Logger } from '../lib/logger.js';

/**
 * Request body for client error logging.
 */
interface ClientErrorLog {
  debugBlock: string;
  url: string;
  userAgent: string;
}

export interface ClientErrorRouterDeps {
  logger: Logger;
}

/**
 * Create router for client-side error logging.
 *
 * POST /api/log-client-error
 * - Accepts { debugBlock, url, userAgent }
 * - Logs with op: 'client.error'
 * - Returns 204 on success, 400 if debugBlock missing
 */
export function createClientErrorRouter(deps: ClientErrorRouterDeps): Router {
  const router = Router();

  router.post('/log-client-error', (req, res) => {
    const body = req.body as Partial<ClientErrorLog>;

    if (!body.debugBlock) {
      res.status(400).json({
        error: {
          type: 'ValidationError',
          message: 'debugBlock is required',
        },
      });
      return;
    }

    deps.logger.error('client.error', 'Client-side error reported', {
      debugBlock: body.debugBlock,
      url: body.url ?? 'unknown',
      userAgent: body.userAgent ?? 'unknown',
    });

    res.status(204).send();
  });

  return router;
}
