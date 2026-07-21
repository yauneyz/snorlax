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

type Platform = keyof typeof STABLE_INSTALLER_KEYS;
const platforms = PLATFORMS as Platform[];

describe('release command boundaries', () => {
  it('keeps release:local free of cloud publishing operations', () => {
    const localReleaseSource = readFileSync(
      resolve(__dirname, '../../scripts/release-local.mjs'),
      'utf8',
    );

    expect(localReleaseSource).not.toContain('scripts/upload-release.mjs');
    expect(localReleaseSource).not.toContain('sync:env:prod');
    expect(localReleaseSource).not.toMatch(/execFileSync\(['"](?:aws|vercel)['"]/);
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
      mode: 'live',
      publishable_key_test: 'pk_test_example',
      publishable_key_live: 'pk_live_example',
    },
    google_auth: { enabled_dev: false, enabled_prod: true },
    extension_hosting: { public_s3_base_url: 'https://releases.example.com/' },
  };

  it('derives production-safe public desktop values from credentials', () => {
    expect(Object.fromEntries(desktopEnvPairs(credentials, 'prod'))).toMatchObject({
      APP_ENV: 'production',
      TALYSMAN_PIPE: 'talysman',
      GOOGLE_AUTH_ENABLED: 'true',
      API_BASE_URL: 'https://www.talysman.app',
      VITE_SUPABASE_URL: 'https://example.supabase.co',
      VITE_SUPABASE_ANON_KEY: 'prod-anon',
      VITE_STRIPE_PUBLISHABLE_KEY: 'pk_live_example',
      UPDATE_FEED_URL: 'https://releases.example.com/desktop',
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
