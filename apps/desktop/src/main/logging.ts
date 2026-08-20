/**
 * Shared logger.
 *
 * Console gets every level (useful when running from a terminal in dev). Disk gets **errors
 * only** — a packaged app that never fails should never grow a log file.
 *
 * The file transport is deliberately hand-rolled rather than delegated to electron-log:
 * `files:` in electron-builder.yml ships only `apps/desktop/out`, so no `node_modules` reach the
 * asar and `require('electron-log')` throws in a packaged build. That failure was silent — the
 * logger fell back to `console`, which goes nowhere for a windowed process, so a packaged app
 * that failed at startup left no trace on disk at all. Never let that happen again: writing the
 * file ourselves depends on nothing that packaging can drop.
 */

type Level = 'info' | 'warn' | 'error' | 'debug';

interface Logger {
  info: (...args: unknown[]) => void;
  warn: (...args: unknown[]) => void;
  error: (...args: unknown[]) => void;
  debug: (...args: unknown[]) => void;
  /** Absolute path of the error log, or null when running outside Electron (unit tests). */
  errorLogPath: () => string | null;
}

/** Rotate at 1MB and keep a single previous file: errors only, so this should never fill. */
const MAX_BYTES = 1024 * 1024;

let resolvedPath: string | null | undefined;

/**
 * `<userData>/logs/errors.log`. Resolved lazily and cached: `app.getPath` throws before the app
 * is ready, and Electron is absent entirely under vitest.
 */
function errorLogPath(): string | null {
  if (resolvedPath !== undefined) return resolvedPath;
  let next: string | null;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { app } = require('electron');
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const path = require('node:path');
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const fs = require('node:fs');
    const dir = path.join(app.getPath('userData'), 'logs');
    fs.mkdirSync(dir, { recursive: true });
    next = path.join(dir, 'errors.log') as string;
  } catch {
    next = null;
  }
  resolvedPath = next;
  return next;
}

function format(args: unknown[]): string {
  return args
    .map((a) => {
      if (a instanceof Error) return a.stack ?? `${a.name}: ${a.message}`;
      if (typeof a === 'string') return a;
      try {
        return JSON.stringify(a);
      } catch {
        return String(a);
      }
    })
    .join(' ');
}

/** Append one error line. Best-effort: logging must never take the app down. */
function appendError(args: unknown[]): void {
  const file = errorLogPath();
  if (!file) return;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const fs = require('node:fs');
    if (fs.statSync(file, { throwIfNoEntry: false })?.size >= MAX_BYTES) {
      fs.renameSync(file, `${file}.old`);
    }
    fs.appendFileSync(file, `[${new Date().toISOString()}] ${format(args)}\n`);
  } catch {
    /* disk full, permissions, a racing rotate — never surface as a crash */
  }
}

function makeLogger(): Logger {
  const emit =
    (level: Level) =>
    (...args: unknown[]) => {
      console[level === 'debug' ? 'log' : level](`[talysman:${level}]`, ...args);
      if (level === 'error') appendError(args);
    };
  return {
    info: emit('info'),
    warn: emit('warn'),
    error: emit('error'),
    debug: emit('debug'),
    errorLogPath,
  };
}

export const logger = makeLogger();
