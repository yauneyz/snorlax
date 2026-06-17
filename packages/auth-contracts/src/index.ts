import { z } from 'zod';

export const DESKTOP_AUTH_CALLBACK_PATH = 'auth/callback';
export const DESKTOP_BILLING_SUCCESS_PATH = 'billing/success';
export const DESKTOP_BILLING_CANCEL_PATH = 'billing/cancel';
export const DESKTOP_DEEP_LINK_SCHEME = 'focuslock';

export const authStatusSchema = z.object({
  signedIn: z.boolean(),
  email: z.string().email().optional(),
});

export type AuthStatus = z.infer<typeof authStatusSchema>;

export const bearerTokenSchema = z
  .string()
  .regex(/^Bearer\s+.+$/i, 'Expected Authorization: Bearer <token>');

export function extractBearerToken(header: string | null): string | null {
  const parsed = bearerTokenSchema.safeParse(header ?? '');
  if (!parsed.success) return null;
  return parsed.data.replace(/^Bearer\s+/i, '').trim();
}

export function desktopDeepLinkUrl(
  path: string,
  params: Record<string, string | undefined> = {},
): string {
  const url = new URL(`${DESKTOP_DEEP_LINK_SCHEME}://${path}`);
  for (const [key, value] of Object.entries(params)) {
    if (value) url.searchParams.set(key, value);
  }
  return url.toString();
}
