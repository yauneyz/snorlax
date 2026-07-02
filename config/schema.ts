import { z } from 'zod';

/**
 * The single Zod schema for every configuration variable the app understands.
 * Validated once at startup by config/load.ts so the rest of the codebase imports a
 * fully-typed `config` object and never touches `process.env` directly (architecture §11).
 *
 * Auth/payment vars are intentionally lax (optional / allow empty) for phases 1-2 where
 * they are unused. Phase 3 tightens these.
 */
export const configSchema = z.object({
  APP_ENV: z.enum(['development', 'production']).default('development'),

  /** Base name for the local IPC pipe shared with the native service. */
  TALYSMAN_PIPE: z.string().min(1).default('talysman'),

  // ---- Auth / payments (unused until Phase 3) ----
  VITE_SUPABASE_URL: z.string().optional().default(''),
  VITE_SUPABASE_ANON_KEY: z.string().optional().default(''),
  VITE_STRIPE_PUBLISHABLE_KEY: z.string().optional().default(''),
  VITE_PAYMENT_URL: z.string().optional().default(''),
  API_BASE_URL: z.string().optional().default(''),

  // ---- Auto-update (unused until Phase 4) ----
  UPDATE_FEED_URL: z.string().optional().default(''),
});

export type AppConfig = z.infer<typeof configSchema>;

/**
 * Validate a raw record (typically `process.env` merged from .env files) against the
 * schema. Throws a readable aggregated error on failure so the app fails fast.
 */
export function parseConfig(raw: Record<string, string | undefined>): AppConfig {
  const result = configSchema.safeParse(raw);
  if (!result.success) {
    const issues = result.error.issues
      .map((i) => `  - ${i.path.join('.') || '(root)'}: ${i.message}`)
      .join('\n');
    throw new Error(`Invalid Talysman configuration:\n${issues}`);
  }
  return result.data;
}
