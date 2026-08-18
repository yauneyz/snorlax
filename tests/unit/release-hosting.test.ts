import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

import {
  BUILD_SCRIPTS,
  PLATFORMS,
  buildablePlatformsForHost,
  STABLE_INSTALLER_KEYS,
  artifactIdentity,
  classifyArtifact,
  contentTypeFor,
  metadataArtifactNames,
  hostingFromCredentials,
  platformsForHost,
  publicUrlFor,
  selectArtifacts,
  // eslint-disable-next-line @typescript-eslint/ban-ts-comment
  // @ts-ignore — untyped .mjs module shared with release scripts
} from '../../scripts/lib/release-hosting.mjs';
import {
  REQUIRED_PRODUCTION_DESKTOP_ENV,
  desktopEnvPairs,
  verifyDirectDesktopApiBaseUrl,
  // eslint-disable-next-line @typescript-eslint/ban-ts-comment
  // @ts-ignore — untyped .mjs module shared with release scripts
} from '../../scripts/lib/desktop-environment.mjs';
import {
  DEFAULT_APPLE_CERTIFICATE_PATH,
  appleReleaseEnvironment,
  // eslint-disable-next-line @typescript-eslint/ban-ts-comment
  // @ts-ignore — untyped .mjs module shared with release scripts
} from '../../scripts/lib/apple-release.mjs';

type Platform = keyof typeof STABLE_INSTALLER_KEYS;
const platforms = PLATFORMS as Platform[];

describe('release command boundaries', () => {
  const localReleaseSource = readFileSync(
    resolve(__dirname, '../../scripts/release-local.mjs'),
    'utf8',
  );
  const nativeBuildSource = readFileSync(
    resolve(__dirname, '../../scripts/build-native.mjs'),
    'utf8',
  );
  const electronBuilderConfig = readFileSync(
    resolve(__dirname, '../../electron-builder.yml'),
    'utf8',
  );

  it('keeps release:local free of cloud publishing operations', () => {
    expect(localReleaseSource).not.toContain('scripts/upload-release.mjs');
    expect(localReleaseSource).not.toContain('sync:env:prod');
    expect(localReleaseSource).not.toMatch(/execFileSync\(['"](?:aws|vercel)['"]/);
  });

  it('pins daemon input updates to committed HEAD through the host-agnostic source link', () => {
    expect(localReleaseSource).toContain("capture('git', ['rev-parse', 'HEAD'])");
    expect(localReleaseSource).toContain("join(homedir(), '.snorlax-src')");
    expect(localReleaseSource).toContain("'--override-input'");
  });

  it('packages target-specific native binaries without rewriting the live development copy', () => {
    expect(nativeBuildSource).not.toContain('const currentOutDir');
    expect(nativeBuildSource).not.toContain('rmSync(currentOutDir');
    expect(electronBuilderConfig).not.toMatch(
      /from:\s*apps\/desktop\/resources\/bin\/current/,
    );
    for (const platform of ['win', 'mac', 'linux']) {
      expect(electronBuilderConfig).toContain(
        `from: apps/desktop/resources/bin/${platform}`,
      );
    }
  });
});

describe('macOS release credentials', () => {
  const root = '/repo';
  const p12 = `/repo/${DEFAULT_APPLE_CERTIFICATE_PATH}`;
  const p8 = '/repo/local-credentials/apple/AuthKey_TEST.p8';
  const pathExists = (path: string) => path === p12 || path === p8;

  it('uses the ignored local p12 and .credentials values for a manual release', () => {
    const result = appleReleaseEnvironment({
      root,
      env: {},
      pathExists,
      credentials: {
        apple: {
          certificate_password: 'p12-password',
          api_key_path: 'local-credentials/apple/AuthKey_TEST.p8',
          api_key_id: 'KEY123',
          api_issuer: '00000000-0000-0000-0000-000000000000',
          team_id: '456BD9S45N',
        },
      },
    });

    expect(result).toMatchObject({
      CSC_LINK: p12,
      CSC_KEY_PASSWORD: 'p12-password',
      APPLE_API_KEY: p8,
      APPLE_API_KEY_ID: 'KEY123',
      APPLE_TEAM_ID: '456BD9S45N',
    });
  });

  it('preserves the GitHub Actions environment contract', () => {
    const result = appleReleaseEnvironment({
      root,
      credentials: null,
      pathExists,
      env: {
        CSC_LINK: p12,
        CSC_KEY_PASSWORD: 'ci-password',
        APPLE_API_KEY: p8,
        APPLE_API_KEY_ID: 'CIKEY',
        APPLE_API_ISSUER: '11111111-1111-1111-1111-111111111111',
        APPLE_TEAM_ID: '456BD9S45N',
      },
    });
    expect(result.CSC_LINK).toBe(p12);
    expect(result.CSC_KEY_PASSWORD).toBe('ci-password');
  });

  it('uses an existing notarytool Keychain profile without API-key values', () => {
    const result = appleReleaseEnvironment({
      root,
      pathExists,
      env: { APPLE_API_KEY_ID: 'stale-partial-value' },
      credentials: {
        apple: {
          certificate_password: 'p12-password',
          keychain_profile: 'talysman-notary',
        },
      },
    });

    expect(result).toMatchObject({
      CSC_LINK: p12,
      CSC_KEY_PASSWORD: 'p12-password',
      APPLE_KEYCHAIN_PROFILE: 'talysman-notary',
    });
    expect(result.APPLE_API_KEY_ID).toBeUndefined();
    expect(result.APPLE_API_KEY).toBeUndefined();
  });

  it('fails before building when notarization credentials are incomplete', () => {
    expect(() =>
      appleReleaseEnvironment({
        root,
        env: {},
        pathExists,
        credentials: { apple: { certificate_password: 'p12-password' } },
      }),
    ).toThrow(/notarization authentication/);
  });
});

describe('desktop release environment', () => {
  const credentials = {
    app: { url_dev: 'http://localhost:3000', url_prod: 'https://www.talysman.app' },
    supabase: {
      dev: { url: 'http://localhost:54321', publishable_key: 'dev-anon' },
      prod: { url: 'https://example.supabase.co', publishable_key: 'prod-anon' },
    },
    stripe: {
      publishable_key_test: 'pk_test_example',
      publishable_key_live: 'pk_live_example',
    },
    google_auth: { enabled_dev: false, enabled_prod: true },
    extension_hosting: { public_s3_base_url: 'https://releases.example.com/' },
  };

  it('derives production-safe public desktop values from credentials', () => {
    expect(
      Object.fromEntries(desktopEnvPairs(credentials, 'prod', { stripeTarget: 'production' })),
    ).toMatchObject({
      APP_ENV: 'production',
      TALYSMAN_PIPE: 'talysman',
      GOOGLE_AUTH_ENABLED: 'true',
      API_BASE_URL: 'https://www.talysman.app',
      VITE_SUPABASE_URL: 'https://example.supabase.co',
      VITE_SUPABASE_ANON_KEY: 'prod-anon',
      STRIPE_MODE: 'live',
      VITE_STRIPE_PUBLISHABLE_KEY: 'pk_live_example',
      UPDATE_FEED_URL: 'https://releases.example.com/desktop',
    });
  });

  it('keeps prod infrastructure on test Stripe unless the build is the published one', () => {
    // release:local and `sync:env --mode=prod` both take this path: prod Supabase and prod
    // API, test Stripe. Only a build that declares itself the production target gets live.
    expect(Object.fromEntries(desktopEnvPairs(credentials, 'prod'))).toMatchObject({
      APP_ENV: 'production',
      API_BASE_URL: 'https://www.talysman.app',
      STRIPE_MODE: 'test',
      VITE_STRIPE_PUBLISHABLE_KEY: 'pk_test_example',
    });
  });

  it('requires every endpoint needed by a packaged production desktop app', () => {
    expect(REQUIRED_PRODUCTION_DESKTOP_ENV).toEqual([
      'API_BASE_URL',
      'VITE_SUPABASE_URL',
      'VITE_SUPABASE_ANON_KEY',
      'UPDATE_FEED_URL',
    ]);
  });

  it('accepts a direct API origin', async () => {
    const fetchImpl = async () =>
      new Response('{"error":"Missing bearer token"}', { status: 401 });

    await expect(
      verifyDirectDesktopApiBaseUrl('https://www.talysman.app', fetchImpl),
    ).resolves.toBeUndefined();
  });

  it('rejects an API origin that redirects and would drop bearer credentials', async () => {
    const fetchImpl = async () =>
      new Response(null, {
        status: 308,
        headers: { location: 'https://www.talysman.app/api/desktop/entitlement' },
      });

    await expect(
      verifyDirectDesktopApiBaseUrl('https://talysman.app', fetchImpl),
    ).rejects.toThrow(/cross-origin redirects strip desktop bearer tokens/);
  });
});

describe('classifyArtifact', () => {
  it('recognizes electron-builder artifact names for each platform', () => {
    expect(classifyArtifact('Talysman-Setup-0.1.0-x64.exe')).toBe('win');
    expect(classifyArtifact('Talysman-0.1.0-arm64.dmg')).toBe('mac');
    expect(classifyArtifact('Talysman-0.1.0-amd64.deb')).toBe('linux');
  });

  it('recognizes prerelease versions', () => {
    expect(classifyArtifact('Talysman-Setup-1.2.3-beta.1-x64.exe')).toBe('win');
    expect(classifyArtifact('Talysman-1.2.3-beta.1-amd64.deb')).toBe('linux');
  });

  it('ignores non-installer files, AppImages, and stale pre-rename artifacts', () => {
    expect(classifyArtifact('Talysman-0.1.0-x86_64.AppImage')).toBeNull();
    expect(classifyArtifact('snorlax.AppImage')).toBeNull();
    expect(classifyArtifact('snorlax.deb')).toBeNull();
    expect(classifyArtifact('FocusLock-0.1.0-amd64.deb')).toBeNull();
    expect(classifyArtifact('latest-linux.yml')).toBeNull();
    expect(classifyArtifact('builder-debug.yml')).toBeNull();
  });
});

describe('selectArtifacts', () => {
  it('picks the newest artifact per platform', () => {
    const selected = selectArtifacts([
      { name: 'Talysman-0.1.0-amd64.deb', mtimeMs: 100 },
      { name: 'Talysman-0.2.0-amd64.deb', mtimeMs: 200 },
      { name: 'Talysman-Setup-0.2.0-x64.exe', mtimeMs: 150 },
      { name: 'Talysman-0.2.0-x86_64.AppImage', mtimeMs: 999 },
    ]);
    expect(selected.linux?.name).toBe('Talysman-0.2.0-amd64.deb');
    expect(selected.win?.name).toBe('Talysman-Setup-0.2.0-x64.exe');
    expect(selected.mac).toBeUndefined();
  });
});

describe('updater feed identity', () => {
  it('extracts platform, version, and normalized architecture', () => {
    expect(artifactIdentity('Talysman-Setup-1.2.3-beta.1-x64.exe')).toEqual({
      platform: 'win',
      version: '1.2.3-beta.1',
      arch: 'x64',
    });
    expect(artifactIdentity('Talysman-1.2.3-amd64.deb')).toEqual({
      platform: 'linux',
      version: '1.2.3',
      arch: 'x64',
    });
  });

  it('extracts relative metadata artifacts and rejects remote or nested paths', () => {
    expect(
      metadataArtifactNames('files:\n  - url: Talysman-1.2.3-x64.zip\npath: Talysman-1.2.3-x64.zip\n'),
    ).toEqual(['Talysman-1.2.3-x64.zip']);
    expect(() => metadataArtifactNames('path: https://other.example/update.zip')).toThrow(
      /relative basename/,
    );
    expect(() => metadataArtifactNames('path: nested/update.zip')).toThrow(/relative basename/);
  });
});

describe('platformsForHost', () => {
  it('scopes uploads to what each build host is responsible for', () => {
    expect(platformsForHost('linux')).toEqual(['win', 'linux']);
    expect(platformsForHost('darwin')).toEqual(['mac']);
    expect(platformsForHost('win32')).toEqual(['win']);
    expect(platformsForHost('freebsd')).toEqual([]);
  });
});

describe('buildablePlatformsForHost', () => {
  it('limits builds to the platform matching the host OS (scripts/build.mjs guard)', () => {
    expect(buildablePlatformsForHost('linux')).toEqual(['linux']);
    expect(buildablePlatformsForHost('darwin')).toEqual(['mac']);
    expect(buildablePlatformsForHost('win32')).toEqual(['win']);
    expect(buildablePlatformsForHost('freebsd')).toEqual([]);
  });
});

describe('BUILD_SCRIPTS', () => {
  it('maps every platform to an existing root package.json script', () => {
    const rootPackage = JSON.parse(
      readFileSync(resolve(__dirname, '../../package.json'), 'utf8'),
    ) as { scripts: Record<string, string> };
    for (const platform of platforms) {
      const script = (BUILD_SCRIPTS as Record<Platform, string>)[platform];
      expect(script, `missing build script mapping for ${String(platform)}`).toBeTruthy();
      expect(rootPackage.scripts[script], `${script} not in package.json`).toBeTruthy();
    }
  });
});

describe('STABLE_INSTALLER_KEYS', () => {
  it('covers every platform under the app/ prefix, with no AppImage anywhere', () => {
    for (const platform of platforms) {
      expect(STABLE_INSTALLER_KEYS[platform]).toMatch(/^app\//);
      expect(STABLE_INSTALLER_KEYS[platform]).not.toMatch(/AppImage/i);
      expect(contentTypeFor(platform)).toBeTruthy();
    }
  });

  it('matches the file names the web download route redirects to', () => {
    // The route owns the public contract; this guards against the two maps drifting.
    const routeSource = readFileSync(
      resolve(__dirname, '../../apps/web/src/app/api/desktop/download/route.ts'),
      'utf8',
    );
    for (const platform of platforms) {
      const basename = STABLE_INSTALLER_KEYS[platform].replace(/^app\//, '');
      expect(routeSource).toContain(`"${basename}"`);
    }
    expect(routeSource).toContain('/app/');
    expect(routeSource).not.toMatch(/AppImage/);
  });
});

describe('publicUrlFor', () => {
  it('joins base URL and key, tolerating trailing slashes', () => {
    const key = STABLE_INSTALLER_KEYS.linux;
    expect(publicUrlFor('https://bucket.s3.amazonaws.com', key)).toBe(
      'https://bucket.s3.amazonaws.com/app/Talysman.deb',
    );
    expect(publicUrlFor('https://bucket.s3.amazonaws.com/', key)).toBe(
      'https://bucket.s3.amazonaws.com/app/Talysman.deb',
    );
  });
});

describe('hostingFromCredentials', () => {
  const valid = {
    aws: {
      region: 'us-east-1',
      access_key_id: 'AKIAEXAMPLE',
      secret_access_key: 'secret',
    },
    extension_hosting: {
      bucket: 'talysman-release-artifacts-prod',
      public_s3_base_url: 'https://talysman-release-artifacts-prod.s3.us-east-1.amazonaws.com',
    },
  };

  it('extracts region, keys, bucket, and public base URL', () => {
    expect(hostingFromCredentials(valid)).toEqual({
      region: 'us-east-1',
      accessKeyId: 'AKIAEXAMPLE',
      secretAccessKey: 'secret',
      bucket: 'talysman-release-artifacts-prod',
      publicBaseUrl: 'https://talysman-release-artifacts-prod.s3.us-east-1.amazonaws.com',
    });
  });

  it('names every missing field', () => {
    expect(() => hostingFromCredentials({})).toThrow(
      /aws\.region.*aws\.access_key_id.*aws\.secret_access_key.*extension_hosting\.bucket.*extension_hosting\.public_s3_base_url/s,
    );
  });

  it('rejects placeholder AWS keys from .credentials.example', () => {
    const placeholder = {
      ...valid,
      aws: { ...valid.aws, access_key_id: 'AKIA...' },
    };
    expect(() => hostingFromCredentials(placeholder)).toThrow(/placeholder/);
  });
});
