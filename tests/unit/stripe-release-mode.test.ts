import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it, vi } from 'vitest';

import {
  ALLOW_TEST_STRIPE_ENV,
  assertLiveStripeRelease,
  desktopStripeReleaseIssues,
  liveStripeCredentialIssues,
  stripeKeyMode,
  stripeModeForTarget,
  stripeReleaseFailure,
  // eslint-disable-next-line @typescript-eslint/ban-ts-comment
  // @ts-ignore — untyped .mjs module shared with release scripts
} from '../../scripts/lib/stripe-mode.mjs';

const liveCredentials = {
  publishable_key_live: 'pk_live_example',
  secret_key_live: 'rk_live_example',
  webhook_secret_live: 'whsec_live_example',
  price_id_monthly_live: 'price_monthly_live',
  price_id_yearly_live: 'price_yearly_live',
};

describe('stripe key mode', () => {
  it('classifies prefixed keys and ignores unfamiliar ones', () => {
    expect(stripeKeyMode('pk_live_abc')).toBe('live');
    expect(stripeKeyMode('sk_test_abc')).toBe('test');
    expect(stripeKeyMode('rk_live_abc')).toBe('live');
    expect(stripeKeyMode('whsec_abc')).toBeNull();
    expect(stripeKeyMode('')).toBeNull();
  });
});

describe('stripe mode derivation', () => {
  it('charges real cards only on the production target', () => {
    expect(stripeModeForTarget('production')).toBe('live');
    expect(stripeModeForTarget('preview')).toBe('test');
    expect(stripeModeForTarget('development')).toBe('test');
  });

  it('refuses to guess for an unknown target', () => {
    expect(() => stripeModeForTarget('prod')).toThrow(/Unknown Stripe target/);
    expect(() => stripeModeForTarget(undefined)).toThrow(/Unknown Stripe target/);
  });
});

describe('credential stripe release readiness', () => {
  it('accepts a fully populated live block', () => {
    expect(liveStripeCredentialIssues(liveCredentials)).toEqual([]);
  });

  it('rejects a live block with empty or test-mode values', () => {
    const issues: string[] = liveStripeCredentialIssues({
      ...liveCredentials,
      publishable_key_live: 'pk_test_example',
      webhook_secret_live: '',
    });
    expect(issues).toEqual([
      expect.stringContaining('stripe.publishable_key_live is not a live value'),
      expect.stringContaining('stripe.webhook_secret_live is empty'),
    ]);
  });
});

describe('desktop build stripe readiness', () => {
  it('accepts a live production build environment', () => {
    expect(
      desktopStripeReleaseIssues({
        STRIPE_MODE: 'live',
        VITE_STRIPE_PUBLISHABLE_KEY: 'pk_live_example',
      }),
    ).toEqual([]);
  });

  it('rejects a test-mode build environment', () => {
    const issues: string[] = desktopStripeReleaseIssues({
      STRIPE_MODE: 'test',
      VITE_STRIPE_PUBLISHABLE_KEY: 'pk_test_example',
    });
    expect(issues).toEqual([
      expect.stringContaining('STRIPE_MODE resolved to "test"'),
      expect.stringContaining('VITE_STRIPE_PUBLISHABLE_KEY is not a live key'),
    ]);
  });

  it('rejects a build that has no Stripe configuration at all', () => {
    const issues: string[] = desktopStripeReleaseIssues({});
    expect(issues).toEqual([
      expect.stringContaining('STRIPE_MODE is unset'),
      expect.stringContaining('VITE_STRIPE_PUBLISHABLE_KEY is empty'),
    ]);
  });

  it('rejects live mode paired with a test key', () => {
    expect(
      desktopStripeReleaseIssues({
        STRIPE_MODE: 'live',
        VITE_STRIPE_PUBLISHABLE_KEY: 'pk_test_example',
      }),
    ).toEqual([expect.stringContaining('VITE_STRIPE_PUBLISHABLE_KEY is not a live key')]);
  });
});

describe('release blocking', () => {
  const options = { surface: 'the published linux desktop installer', environment: {} };
  const issue = ['stripe.secret_key_live is empty — fill it with the live-mode value'];

  it('passes a clean release through', () => {
    expect(stripeReleaseFailure([], options)).toBeNull();
    expect(() => assertLiveStripeRelease([], options)).not.toThrow();
  });

  it('blocks and explains how to fix the configuration', () => {
    const failure = stripeReleaseFailure(issue, options);
    expect(failure).toContain('Refusing to ship an incomplete Stripe configuration');
    expect(failure).toContain('the published linux desktop installer');
    expect(failure).toContain('there is no switch to flip');
    expect(() => assertLiveStripeRelease(issue, options)).toThrow(
      /Refusing to ship an incomplete Stripe configuration/,
    );
  });

  it('warns instead of blocking only under the explicit override', () => {
    const warn = vi.fn();
    expect(
      stripeReleaseFailure(issue, {
        ...options,
        environment: { [ALLOW_TEST_STRIPE_ENV]: 'true' },
        warn,
      }),
    ).toBeNull();
    expect(warn).toHaveBeenCalledOnce();
    expect(warn.mock.calls[0]?.[0]).toContain(ALLOW_TEST_STRIPE_ENV);
  });

  it('does not treat other override values as consent', () => {
    expect(
      stripeReleaseFailure(issue, {
        ...options,
        environment: { [ALLOW_TEST_STRIPE_ENV]: '1' },
      }),
    ).not.toBeNull();
  });
});

describe('release script wiring', () => {
  const read = (path: string) => readFileSync(resolve(__dirname, '../..', path), 'utf8');

  it('gates production desktop builds on live Stripe mode', () => {
    const source = read('scripts/build.mjs');
    expect(source).toContain('assertLiveStripeRelease(desktopStripeReleaseIssues(process.env)');
    expect(source).toContain('process.env.LOCAL_RELEASE_BUILD === "true"');
    expect(source).toContain(
      'credentialMode === "prod" && !isLocalRelease ? "production" : "development"',
    );
  });

  it('exempts release:local, which never publishes anything', () => {
    expect(read('scripts/release-local.mjs')).toContain(
      "process.env.LOCAL_RELEASE_BUILD = 'true'",
    );
  });

  it('gates publishing on live Stripe mode, including --no-build uploads', () => {
    const source = read('scripts/upload-release.mjs');
    expect(source).toContain('assertLiveStripeForPublish();');
    expect(source.indexOf('assertLiveStripeForPublish();')).toBeLessThan(
      source.indexOf(
        'if (!noBuild) buildHostInstallers(buildable, buildEnvironment);',
      ),
    );
  });

  it('derives the web Stripe mode from the push target, with no credential switch', () => {
    const source = read('scripts/sync-env.ts');
    expect(source).toContain('const stripeTarget = vercelEnvironment ?? "development";');
    expect(source).toContain('stripeModeForTarget(stripeTarget)');
    expect(source).toContain('liveStripeCredentialIssues(creds.stripe)');
    // The credentials schema must not reintroduce a hand-set mode.
    expect(source).not.toMatch(/^\s*mode: z\./m);
  });

  it('leaves no reader of a [stripe].mode credential behind', () => {
    for (const path of [
      'scripts/sync-env.ts',
      'scripts/build.mjs',
      'scripts/upload-release.mjs',
      'scripts/lib/desktop-environment.mjs',
    ]) {
      expect(read(path)).not.toContain('stripe.mode');
    }
  });
});
