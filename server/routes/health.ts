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
 * Determine overall system status from integrity report.
 * - 'ok': integrity check passed with zero warnings
 * - 'degraded': integrity check passed but has warnings
 * - 'error': integrity check failed (shouldn't happen if app is running)
 */
function computeStatus(
  integrityOk: boolean,
  schemaVersionOk: boolean,
  warnings: number
): 'ok' | 'degraded' | 'error' {
  if (!schemaVersionOk) {
    return 'error';
  }
  if (warnings > 0 || !integrityOk) {
    return 'degraded';
  }
  return 'ok';
}

/**
 * Create the health router with integrity information.
 *
 * Response format:
 * {
 *   status: "ok" | "degraded" | "error",
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

    // Compute overall status
    const status = computeStatus(integrityOk, integrityReport.schemaVersionOk, warnings);

    res.json({
      status,
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
