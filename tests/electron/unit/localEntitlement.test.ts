import { createPublicKey, generateKeyPairSync, sign } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  canonicalJson,
  type LocalEntitlementPayload,
  verifyLocalEntitlementLicense,
} from '../../../apps/desktop/src/main/auth/localEntitlement.js';

const subject = { hostname: 'devbox', user: 'zac' };
const now = new Date('2026-07-05T12:00:00.000Z');

function keys() {
  const { privateKey } = generateKeyPairSync('ed25519');
  const publicKey = createPublicKey(privateKey)
    .export({ format: 'der', type: 'spki' })
    .toString('base64');
  return { privateKey, publicKey };
}

function signedLicense(overrides: Partial<LocalEntitlementPayload> = {}) {
  const { privateKey, publicKey } = keys();
  const payload: LocalEntitlementPayload = {
    version: 1,
    plan: 'pro',
    issuedAt: '2026-07-05T00:00:00.000Z',
    expiresAt: '2027-07-05T00:00:00.000Z',
    reason: 'release-local',
    ...subject,
    ...overrides,
  };
  const signature = sign(null, Buffer.from(canonicalJson(payload), 'utf8'), privateKey).toString(
    'base64url',
  );
  return { publicKey, raw: JSON.stringify({ ...payload, signature }) };
}

describe('local entitlement license', () => {
  it('accepts a signed Pro license for the current local subject', () => {
    const license = signedLicense();
    const result = verifyLocalEntitlementLicense(license.raw, {
      publicKey: license.publicKey,
      now,
      subject,
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.entitlement).toMatchObject({
        active: true,
        plan: 'pro',
        source: 'local-license',
        status: 'release-local',
      });
    }
  });

  it('rejects a tampered license', () => {
    const license = signedLicense({ plan: 'free' });
    const tampered = license.raw.replace('"free"', '"pro"');

    const result = verifyLocalEntitlementLicense(tampered, {
      publicKey: license.publicKey,
      now,
      subject,
    });

    expect(result).toEqual({ ok: false, reason: 'invalid signature' });
  });

  it('rejects an expired license', () => {
    const license = signedLicense({ expiresAt: '2026-07-04T00:00:00.000Z' });

    const result = verifyLocalEntitlementLicense(license.raw, {
      publicKey: license.publicKey,
      now,
      subject,
    });

    expect(result).toEqual({ ok: false, reason: 'license expired' });
  });

  it('rejects a license for another local subject', () => {
    const license = signedLicense({ hostname: 'otherbox' });

    const result = verifyLocalEntitlementLicense(license.raw, {
      publicKey: license.publicKey,
      now,
      subject,
    });

    expect(result).toEqual({ ok: false, reason: 'license hostname mismatch' });
  });
});
