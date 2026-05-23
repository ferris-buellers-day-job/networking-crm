import { Router } from 'express';
import { execSync } from 'child_process';
import { createRequire } from 'module';
import type { IntegrityReport } from '../lib/integrity-check.js';

const require = createRequire(import.meta.url);
const pkg = require('../../package.json') as { version: string };

export interface HealthRouterDeps {
  integrityReport: IntegrityReport;
  integrityCheckedAt: string;
}

function getGitCommit(): string {
  try {
    return execSync('git rev-parse --short HEAD', { encoding: 'utf-8' }).trim();
  } catch {
    return 'unknown';
  }
}

/**
 * Create the health router with integrity information.
 *
 * Response format:
 * {
 *   ok: true,                    // Always true if Express is running
 *   version: "0.1.0",
 *   commit: "abc1234",
 *   integrity: {
 *     ok: true,                  // True if no issues detected
 *     warnings: 2,               // Count of non-fatal issues
 *     lastChecked: "2026-05-23T..." // ISO timestamp
 *   }
 * }
 */
export function createHealthRouter(deps: HealthRouterDeps): Router {
  const router = Router();

  router.get('/health', (_req, res) => {
    const { integrityReport, integrityCheckedAt } = deps;

    // Count warnings (non-fatal issues)
    const warnings =
      integrityReport.conflictFiles.length +
      integrityReport.quarantinedFiles.length +
      integrityReport.errors.length +
      (integrityReport.cacheRebuilt ? 1 : 0);

    // Integrity is "ok" if schema version is fine and no warnings
    const integrityOk = integrityReport.schemaVersionOk && warnings === 0;

    res.json({
      ok: true, // Server is running, always true here
      version: pkg.version,
      commit: getGitCommit(),
      integrity: {
        ok: integrityOk,
        warnings,
        lastChecked: integrityCheckedAt,
      },
    });
  });

  return router;
}
