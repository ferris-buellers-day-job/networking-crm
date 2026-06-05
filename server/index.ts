import express from 'express';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';
import { homedir } from 'os';
import { createHealthRouter } from './routes/health.js';
import { createClientErrorRouter } from './routes/client-error.js';
import { createContactsRouter } from './routes/contacts.js';
import { createErrorHandler } from './middleware/error-handler.js';
import { initStorage, FatalStorageError, type StorageContext } from './services/storage.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const isProduction = process.env.NODE_ENV === 'production';
const port = parseInt(process.env.PORT || '3000', 10);
const host = process.env.BIND_HOST || '127.0.0.1';

// Expand ~ in paths
function expandPath(p: string): string {
  if (p === '~') {
    return homedir();
  }
  if (p.startsWith('~/')) {
    return resolve(homedir(), p.slice(2));
  }
  return resolve(p);
}

// Load config from environment
const config = {
  dataPath: expandPath(process.env.DATA_PATH || '~/Library/Mobile Documents/com~apple~CloudDocs/NetworkingCRM'),
  cacheDbPath: expandPath(process.env.CACHE_DB_PATH || './data/cache.db'),
  backupPath: expandPath(process.env.BACKUP_PATH || '~/NetworkingCRM-backup'),
  logRetentionDays: parseInt(process.env.LOG_RETENTION_DAYS || '30', 10),
};

// Shutdown timeout (10 seconds)
const SHUTDOWN_TIMEOUT_MS = 10_000;

let storage: StorageContext | null = null;
let isShuttingDown = false;

/**
 * Graceful shutdown handler.
 * Stops all services in order with a hard timeout.
 */
async function shutdown(signal: string): Promise<void> {
  if (isShuttingDown) {
    console.error(`Shutdown already in progress (received ${signal})`);
    return;
  }
  isShuttingDown = true;

  console.log(`\nReceived ${signal}, shutting down...`);

  // If storage hasn't been initialized yet, exit immediately
  // Exit code 130 = 128 + SIGINT(2), standard for "terminated by signal"
  if (storage === null) {
    console.log('Shutdown during initialization, exiting immediately');
    process.exit(130);
  }

  // Set hard timeout
  const timeoutId = setTimeout(() => {
    console.error('Shutdown timed out after 10 seconds, forcing exit');
    process.exit(1);
  }, SHUTDOWN_TIMEOUT_MS);

  try {
    await storage.stop();
    clearTimeout(timeoutId);
    console.log('Shutdown complete');
    process.exit(0);
  } catch (err) {
    clearTimeout(timeoutId);
    console.error('Error during shutdown:', (err as Error).message);
    process.exit(1);
  }
}

async function main(): Promise<void> {
  // Register signal handlers early, before any async work
  // This ensures clean shutdown even if interrupted during initialization
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));

  // 1. Initialize storage layer
  try {
    storage = await initStorage(config);
  } catch (err) {
    if (err instanceof FatalStorageError) {
      console.error(err.message);
      process.exit(err.exitCode);
    }
    // Unexpected error
    console.error('Unexpected error during storage initialization:', (err as Error).message);
    process.exit(1);
  }

  // 2. Run initial backup (log warning if fails, continue)
  const backupResult = await storage.backupService.run();
  if (backupResult.error) {
    storage.logger.warn('startup.backup', 'Initial backup failed', { error: backupResult.error });
    console.error(`⚠️  Warning: Initial backup failed: ${backupResult.error}`);
  } else if (backupResult.committed) {
    storage.logger.info('startup.backup', 'Initial backup completed', {
      changedFiles: backupResult.changedFiles,
    });
  } else {
    storage.logger.info('startup.backup', 'Initial backup skipped (no changes)');
  }

  // 3. Start file watcher and backup scheduler
  try {
    storage.start();
  } catch (err) {
    storage.logger.warn('startup.watcher', 'File watcher failed to start', {
      error: (err as Error).message,
    });
    console.error(`⚠️  Warning: File watcher failed to start: ${(err as Error).message}`);
    // Continue without file watcher - reduced functionality
  }

  // 4. Create Express app
  const app = express();

  // Parse JSON bodies for API routes
  app.use(express.json());

  // API routes
  const healthRouter = createHealthRouter({
    integrityReport: storage.integrityReport,
    integrityCheckedAt: storage.integrityCheckedAt,
  });
  app.use('/api', healthRouter);

  const clientErrorRouter = createClientErrorRouter({
    logger: storage.logger,
  });
  app.use('/api', clientErrorRouter);

  const contactsRouter = createContactsRouter({
    contactsStore: storage.contactsStore,
  });
  app.use('/api/contacts', contactsRouter);

  if (isProduction) {
    // Production: serve static files from dist/client
    const distPath = resolve(__dirname, '../dist/client');
    app.use(express.static(distPath));
    app.get('*', (_req, res) => {
      res.sendFile(resolve(distPath, 'index.html'));
    });
  } else {
    // Development: use Vite dev server as middleware
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  }

  // Error handler middleware — must be registered LAST
  app.use(createErrorHandler(storage.logger));

  const server = app.listen(port, host, () => {
    storage?.logger.info('startup.complete', 'Server started', { host, port });
    console.log(`Server running at http://${host}:${port}`);
  });

  // Handle listen errors (e.g., port already in use)
  server.on('error', (err: NodeJS.ErrnoException) => {
    storage?.logger.error('startup.listen', 'Failed to bind server', { error: err.message });
    console.error(`Failed to start server: ${err.message}`);
    process.exit(1);
  });
}

main();
