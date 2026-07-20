import { createPublicKey, verify } from 'node:crypto';
import { hostname as osHostname, userInfo } from 'node:os';
import { z } from 'zod';
import {
  type Entitlement,
  entitlementForPlan,
  subscriptionPlanSchema,
} from '@talysman/product';

export const LOCAL_ENTITLEMENT_FILE = 'local-entitlement.json';

const CLOCK_SKEW_MS = 5 * 60 * 1000;

const localEntitlementPayloadSchema = z.object({
  version: z.literal(1),
  plan: subscriptionPlanSchema,
  issuedAt: z.string().min(1),
  expiresAt: z.string().min(1).optional(),
  notBefore: z.string().min(1).optional(),
  reason: z.string().min(1).optional(),
  hostname: z.string().min(1).optional(),
  user: z.string().min(1).optional(),
});

const localEntitlementLicenseSchema = localEntitlementPayloadSchema.extend({
  signature: z.string().min(1),
});

export type LocalEntitlementPayload = z.infer<typeof localEntitlementPayloadSchema>;
export type LocalEntitlementLicense = z.infer<typeof localEntitlementLicenseSchema>;

export interface LocalEntitlementSubject {
  hostname: string;
  user: string;
}

export type LocalEntitlementVerification =
  | { ok: true; entitlement: Entitlement; license: LocalEntitlementLicense }
  | { ok: false; reason: string };

export function currentLocalEntitlementSubject(): LocalEntitlementSubject {
  let user: string;
  try {
    user = userInfo().username;
  } catch {
    user = process.env.USER ?? process.env.USERNAME ?? '';
  }
  return { hostname: osHostname(), user };
}

export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map((item) => canonicalJson(item)).join(',')}]`;

  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => a.localeCompare(b));

  return `{${entries
    .map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`)
    .join(',')}}`;
}

function parseDate(value: string, field: string): Date | { error: string } {
  const time = Date.parse(value);
  if (!Number.isFinite(time)) return { error: `invalid ${field}` };
  return new Date(time);
}

function publicKeyFromConfig(publicKey: string) {
  const trimmed = publicKey.trim();
  if (trimmed.includes('-----BEGIN PUBLIC KEY-----')) return createPublicKey(trimmed);
  return createPublicKey({
    key: Buffer.from(trimmed, 'base64'),
    format: 'der',
    type: 'spki',
  });
}

function signaturePayload(license: LocalEntitlementLicense): LocalEntitlementPayload {
  const { signature: _signature, ...payload } = license;
  return payload;
}

export function verifyLocalEntitlementLicense(
  raw: string,
  args: {
    publicKey: string;
    now?: Date;
    subject?: LocalEntitlementSubject;
  },
): LocalEntitlementVerification {
  if (!args.publicKey.trim()) return { ok: false, reason: 'local entitlement is not configured' };

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { ok: false, reason: 'invalid JSON' };
  }

  const schemaResult = localEntitlementLicenseSchema.safeParse(parsed);
  if (!schemaResult.success) return { ok: false, reason: 'invalid license shape' };

  const license = schemaResult.data;
  const payload = signaturePayload(license);
  const now = args.now ?? new Date();
  const issuedAt = parseDate(payload.issuedAt, 'issuedAt');
  if ('error' in issuedAt) return { ok: false, reason: issuedAt.error };
  if (issuedAt.getTime() > now.getTime() + CLOCK_SKEW_MS) {
    return { ok: false, reason: 'license issued in the future' };
  }

  if (payload.notBefore) {
    const notBefore = parseDate(payload.notBefore, 'notBefore');
    if ('error' in notBefore) return { ok: false, reason: notBefore.error };
    if (notBefore.getTime() > now.getTime() + CLOCK_SKEW_MS) {
      return { ok: false, reason: 'license is not active yet' };
    }
  }

  if (payload.expiresAt) {
    const expiresAt = parseDate(payload.expiresAt, 'expiresAt');
    if ('error' in expiresAt) return { ok: false, reason: expiresAt.error };
    if (expiresAt.getTime() <= now.getTime()) return { ok: false, reason: 'license expired' };
  }

  const subject = args.subject ?? currentLocalEntitlementSubject();
  if (payload.hostname && payload.hostname !== subject.hostname) {
    return { ok: false, reason: 'license hostname mismatch' };
  }
  if (payload.user && payload.user !== subject.user) {
    return { ok: false, reason: 'license user mismatch' };
  }

  let verified: boolean;
  try {
    verified = verify(
      null,
      Buffer.from(canonicalJson(payload), 'utf8'),
      publicKeyFromConfig(args.publicKey),
      Buffer.from(license.signature, 'base64url'),
    );
  } catch {
    return { ok: false, reason: 'invalid signature material' };
  }

  if (!verified) return { ok: false, reason: 'invalid signature' };

  const metadata: Parameters<typeof entitlementForPlan>[2] = {
    status: payload.reason ?? 'local_license',
    fetchedAt: now.toISOString(),
  };
  if (payload.expiresAt) {
    metadata.currentPeriodEnd = payload.expiresAt;
    metadata.cacheUntil = payload.expiresAt;
  }

  return {
    ok: true,
    entitlement: entitlementForPlan(payload.plan, 'local-license', metadata),
    license,
  };
}
