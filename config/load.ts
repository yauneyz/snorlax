import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { type AppConfig, parseConfig } from './schema.js';

/**
 * Minimal dotenv parser (no dependency). Handles `KEY=value`, comments, blank lines,
 * and surrounding single/double quotes. Intentionally tiny — this only ever parses our
 * own committed .env files.
 */
function parseDotenv(contents: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const rawLine of contents.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (key) out[key] = value;
  }
  return out;
}

function readEnvFile(dir: string, name: string): Record<string, string> {
  const path = resolve(dir, name);
  if (!existsSync(path)) return {};
  return parseDotenv(readFileSync(path, 'utf8'));
}

/**
 * Load and validate configuration with the precedence (highest wins):
 *   process.env > .env.local > .env.<mode> > .env
 *
 * `mode` defaults to APP_ENV from the environment (or 'development'). The returned object
 * is the only sanctioned source of config across the codebase.
 */
export function loadConfig(rootDir: string = process.cwd()): AppConfig {
  const mode = process.env.APP_ENV ?? readEnvFile(rootDir, '.env').APP_ENV ?? 'development';

  const merged: Record<string, string | undefined> = {
    ...readEnvFile(rootDir, '.env'),
    ...readEnvFile(rootDir, `.env.${mode}`),
    ...readEnvFile(rootDir, '.env.local'),
    ...process.env,
  };

  return parseConfig(merged);
}
