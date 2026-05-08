import { appendFileSync, mkdirSync, readdirSync, unlinkSync, existsSync } from 'node:fs';
import path from 'node:path';

export interface Logger {
  info(op: string, msg: string, meta?: object): void;
  warn(op: string, msg: string, meta?: object): void;
  error(op: string, msg: string, meta?: object): void;
  debug(op: string, msg: string, meta?: object): void;
}

export interface LoggerOptions {
  retentionDays?: number;
  /** Override for testing - returns current date string YYYY-MM-DD */
  getCurrentDate?: () => string;
  /** Override for testing - returns current ISO timestamp */
  getCurrentTimestamp?: () => string;
}

type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const LOG_LEVELS: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

function getDateFromFilename(filename: string): string | null {
  const match = filename.match(/^app-(\d{4}-\d{2}-\d{2})\.log$/);
  return match ? match[1] : null;
}

function isOlderThanDays(dateStr: string, days: number, referenceDate: string): boolean {
  const fileDate = new Date(dateStr);
  const refDate = new Date(referenceDate);
  const diffMs = refDate.getTime() - fileDate.getTime();
  const diffDays = diffMs / (1000 * 60 * 60 * 24);
  return diffDays > days;
}

/**
 * Creates a structured JSON logger.
 *
 * Writes JSON lines to `logDir/app-YYYY-MM-DD.log`:
 * {"ts":"...","level":"info","op":"...","msg":"...","key":"value"}
 *
 * Features:
 * - Rotates by date (new file each day)
 * - Creates logDir if missing
 * - Appends synchronously to avoid losing entries on crash
 * - LOG_LEVEL env var controls minimum level (default: info)
 * - Auto-deletes logs older than retentionDays (default: 30)
 */
export function createLogger(logDir: string, options: LoggerOptions = {}): Logger {
  const retentionDays = options.retentionDays ?? parseInt(process.env.LOG_RETENTION_DAYS ?? '30', 10);
  const minLevel = (process.env.LOG_LEVEL ?? 'info').toLowerCase() as LogLevel;
  const minLevelNum = LOG_LEVELS[minLevel] ?? LOG_LEVELS.info;

  const getCurrentDate = options.getCurrentDate ?? (() => new Date().toISOString().slice(0, 10));
  const getCurrentTimestamp = options.getCurrentTimestamp ?? (() => new Date().toISOString());

  let currentDate = getCurrentDate();
  let currentLogPath = path.join(logDir, `app-${currentDate}.log`);

  // Ensure log directory exists
  if (!existsSync(logDir)) {
    mkdirSync(logDir, { recursive: true });
  }

  // Run retention cleanup on initialization
  cleanupOldLogs(logDir, retentionDays, currentDate);

  function cleanupOldLogs(dir: string, days: number, refDate: string): void {
    if (!existsSync(dir)) {
      return;
    }

    try {
      const files = readdirSync(dir);
      for (const file of files) {
        const fileDate = getDateFromFilename(file);
        if (fileDate && isOlderThanDays(fileDate, days, refDate)) {
          const filePath = path.join(dir, file);
          try {
            unlinkSync(filePath);
            // Log deletion at debug level (write directly to avoid recursion issues)
            writeLog('debug', 'logger.cleanup', `Deleted old log file: ${file}`, {});
          } catch {
            // Ignore deletion errors
          }
        }
      }
    } catch {
      // Ignore read errors
    }
  }

  function checkDateRotation(): void {
    const newDate = getCurrentDate();
    if (newDate !== currentDate) {
      currentDate = newDate;
      currentLogPath = path.join(logDir, `app-${currentDate}.log`);
      // Run retention cleanup on date rollover
      cleanupOldLogs(logDir, retentionDays, currentDate);
    }
  }

  function writeLog(level: LogLevel, op: string, msg: string, meta: object): void {
    checkDateRotation();

    const entry = {
      ts: getCurrentTimestamp(),
      level,
      op,
      msg,
      ...meta,
    };

    const line = JSON.stringify(entry) + '\n';

    try {
      appendFileSync(currentLogPath, line, 'utf-8');
    } catch (err) {
      // If write fails, try to create directory and retry once
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
        mkdirSync(logDir, { recursive: true });
        appendFileSync(currentLogPath, line, 'utf-8');
      } else {
        throw err;
      }
    }
  }

  function shouldLog(level: LogLevel): boolean {
    return LOG_LEVELS[level] >= minLevelNum;
  }

  return {
    debug(op: string, msg: string, meta?: object): void {
      if (shouldLog('debug')) {
        writeLog('debug', op, msg, meta ?? {});
      }
    },

    info(op: string, msg: string, meta?: object): void {
      if (shouldLog('info')) {
        writeLog('info', op, msg, meta ?? {});
      }
    },

    warn(op: string, msg: string, meta?: object): void {
      if (shouldLog('warn')) {
        writeLog('warn', op, msg, meta ?? {});
      }
    },

    error(op: string, msg: string, meta?: object): void {
      if (shouldLog('error')) {
        writeLog('error', op, msg, meta ?? {});
      }
    },
  };
}
