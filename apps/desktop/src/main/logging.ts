/** Shared logger. Wraps electron-log when available, falls back to console otherwise. */

type Level = 'info' | 'warn' | 'error' | 'debug';

interface Logger {
  info: (...args: unknown[]) => void;
  warn: (...args: unknown[]) => void;
  error: (...args: unknown[]) => void;
  debug: (...args: unknown[]) => void;
}

function makeLogger(): Logger {
  try {
    // electron-log is optional at runtime (not present in pure unit tests).

    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const log = require('electron-log');
    if (log.transports?.file) log.transports.file.level = 'info';
    return log as Logger;
  } catch {
    const emit = (level: Level) => (...args: unknown[]) =>
      console[level === 'debug' ? 'log' : level](`[talysman:${level}]`, ...args);
    return { info: emit('info'), warn: emit('warn'), error: emit('error'), debug: emit('debug') };
  }
}

export const logger = makeLogger();
