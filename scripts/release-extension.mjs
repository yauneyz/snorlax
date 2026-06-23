#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { dirname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import toml from '@iarna/toml';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const extDir = resolve(root, 'apps/extension');
const distDir = resolve(extDir, 'dist');
const releaseDir = resolve(extDir, 'release');
const skipFirefoxSign = process.argv.includes('--skip-firefox-sign');
const skipUpload = process.argv.includes('--skip-upload');

function fail(message) {
  console.error(message);
  process.exit(1);
}

function run(command, args, options = {}) {
  console.log(`\n$ ${[command, ...args].join(' ')}`);
  const result = spawnSync(command, args, {
    cwd: root,
    stdio: 'inherit',
    env: { ...process.env, ...options.env },
  });
  if (result.status !== 0) {
    fail(`${command} failed with exit code ${result.status ?? 1}`);
  }
}

function requiredString(value, path) {
  if (typeof value !== 'string' || value.length === 0) {
    fail(`Missing .credentials value: ${path}`);
  }
  return value;
}

function loadCredentials() {
  const credentialsPath = resolve(root, '.credentials');
  if (!existsSync(credentialsPath)) {
    fail('Missing .credentials. Copy .credentials.example, fill in real release credentials, then retry.');
  }

  const parsed = toml.parse(readFileSync(credentialsPath, 'utf8'));
  return {
    aws: {
      region: requiredString(parsed.aws?.region, 'aws.region'),
      accessKeyId: requiredString(parsed.aws?.access_key_id, 'aws.access_key_id'),
      secretAccessKey: requiredString(parsed.aws?.secret_access_key, 'aws.secret_access_key'),
    },
    hosting: {
      bucket: requiredString(parsed.extension_hosting?.bucket, 'extension_hosting.bucket'),
      publicS3BaseUrl: requiredString(
        parsed.extension_hosting?.public_s3_base_url,
        'extension_hosting.public_s3_base_url',
      ),
      publicAppBaseUrl: requiredString(
        parsed.extension_hosting?.public_app_base_url,
        'extension_hosting.public_app_base_url',
      ),
      chromiumUpdateUrl: requiredString(
        parsed.extension_hosting?.chromium_update_url,
        'extension_hosting.chromium_update_url',
      ),
      firefoxUpdateUrl: requiredString(
        parsed.extension_hosting?.firefox_update_url,
        'extension_hosting.firefox_update_url',
      ),
      firefoxXpiUrl: requiredString(
        parsed.extension_hosting?.firefox_xpi_url,
        'extension_hosting.firefox_xpi_url',
      ),
    },
    signing: {
      chromium: {
        privateKeyPath: requiredString(
          parsed.extension_signing?.chromium?.private_key_path,
          'extension_signing.chromium.private_key_path',
        ),
        expectedExtensionId: requiredString(
          parsed.extension_signing?.chromium?.expected_extension_id,
          'extension_signing.chromium.expected_extension_id',
        ),
      },
      firefox: {
        geckoId: requiredString(
          parsed.extension_signing?.firefox?.gecko_id,
          'extension_signing.firefox.gecko_id',
        ),
        amoJwtIssuer: requiredString(
          parsed.extension_signing?.firefox?.amo_jwt_issuer,
          'extension_signing.firefox.amo_jwt_issuer',
        ),
        amoJwtSecret: requiredString(
          parsed.extension_signing?.firefox?.amo_jwt_secret,
          'extension_signing.firefox.amo_jwt_secret',
        ),
      },
    },
  };
}

function appUrl(hosting, suffix) {
  return `${hosting.publicAppBaseUrl.replace(/\/+$/, '')}/${suffix}`;
}

function assertUrl(name, actual, expected) {
  if (actual !== expected) {
    fail(`${name} is ${actual}, expected ${expected}`);
  }
}

function loadJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

function writeJson(path, value) {
  writeFileSync(path, JSON.stringify(value, null, 2) + '\n');
}

function chromiumIdFromPublicKey(spkiDer) {
  const hash = crypto.createHash('sha256').update(spkiDer).digest();
  let id = '';
  for (let i = 0; i < 16; i++) {
    id += String.fromCharCode(97 + (hash[i] >> 4));
    id += String.fromCharCode(97 + (hash[i] & 0x0f));
  }
  return id;
}

function readChromiumIdentity(privateKeyPath) {
  const privateKey = crypto.createPrivateKey(readFileSync(privateKeyPath, 'utf8'));
  const publicKeyDer = crypto.createPublicKey(privateKey).export({ type: 'spki', format: 'der' });
  return {
    privateKey,
    publicKeyDer,
    crxId: crypto.createHash('sha256').update(publicKeyDer).digest().subarray(0, 16),
    extensionId: chromiumIdFromPublicKey(publicKeyDer),
  };
}

const crcTable = (() => {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let j = 0; j < 8; j++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[i] = c >>> 0;
  }
  return table;
})();

function crc32(buffer) {
  let c = 0xffffffff;
  for (const byte of buffer) {
    c = crcTable[(c ^ byte) & 0xff] ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

function dosDateTime(date = new Date()) {
  const year = Math.max(date.getFullYear(), 1980);
  const dosTime = (date.getHours() << 11) | (date.getMinutes() << 5) | Math.floor(date.getSeconds() / 2);
  const dosDate = ((year - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate();
  return { dosTime, dosDate };
}

function listFiles(dir, base = dir) {
  const entries = [];
  for (const name of readdirSync(dir).sort()) {
    const path = resolve(dir, name);
    const stat = statSync(path);
    if (stat.isDirectory()) {
      entries.push(...listFiles(path, base));
    } else if (stat.isFile()) {
      entries.push({
        path,
        name: relative(base, path).replace(/\\/g, '/'),
      });
    }
  }
  return entries;
}

function uint16(value) {
  const out = Buffer.alloc(2);
  out.writeUInt16LE(value);
  return out;
}

function uint32(value) {
  const out = Buffer.alloc(4);
  out.writeUInt32LE(value >>> 0);
  return out;
}

function uint64(value) {
  const out = Buffer.alloc(8);
  out.writeBigUInt64LE(BigInt(value));
  return out;
}

function zipDirectory(dir) {
  const localParts = [];
  const centralParts = [];
  let offset = 0;
  const { dosTime, dosDate } = dosDateTime();

  for (const entry of listFiles(dir)) {
    const name = Buffer.from(entry.name);
    const data = readFileSync(entry.path);
    const crc = crc32(data);

    const local = Buffer.concat([
      uint32(0x04034b50),
      uint16(20),
      uint16(0),
      uint16(0),
      uint16(dosTime),
      uint16(dosDate),
      uint32(crc),
      uint32(data.length),
      uint32(data.length),
      uint16(name.length),
      uint16(0),
      name,
      data,
    ]);
    localParts.push(local);

    centralParts.push(
      Buffer.concat([
        uint32(0x02014b50),
        uint16(0x031e),
        uint16(20),
        uint16(0),
        uint16(0),
        uint16(dosTime),
        uint16(dosDate),
        uint32(crc),
        uint32(data.length),
        uint32(data.length),
        uint16(name.length),
        uint16(0),
        uint16(0),
        uint16(0),
        uint16(0),
        uint32(0),
        uint32(offset),
        name,
      ]),
    );
    offset += local.length;
  }

  const central = Buffer.concat(centralParts);
  const end = Buffer.concat([
    uint32(0x06054b50),
    uint16(0),
    uint16(0),
    uint16(centralParts.length),
    uint16(centralParts.length),
    uint32(central.length),
    uint32(offset),
    uint16(0),
  ]);

  return Buffer.concat([...localParts, central, end]);
}

function varint(value) {
  const bytes = [];
  let n = BigInt(value);
  while (n >= 0x80n) {
    bytes.push(Number((n & 0x7fn) | 0x80n));
    n >>= 7n;
  }
  bytes.push(Number(n));
  return Buffer.from(bytes);
}

function protoBytes(fieldNumber, value) {
  return Buffer.concat([varint((BigInt(fieldNumber) << 3n) | 2n), varint(value.length), value]);
}

function createCrx(sourceDir, outFile, identity) {
  const zip = zipDirectory(sourceDir);
  const signedHeaderData = protoBytes(1, identity.crxId);
  const signedData = Buffer.concat([
    Buffer.from('CRX3 SignedData\0'),
    uint64(signedHeaderData.length),
    signedHeaderData,
    uint64(zip.length),
    zip,
  ]);
  const signature = crypto.sign('RSA-SHA256', signedData, identity.privateKey);
  const proof = Buffer.concat([protoBytes(1, identity.publicKeyDer), protoBytes(2, signature)]);
  const header = Buffer.concat([protoBytes(2, proof), protoBytes(10000, signedHeaderData)]);

  writeFileSync(
    outFile,
    Buffer.concat([Buffer.from('Cr24'), uint32(3), uint32(header.length), header, zip]),
  );
}

function updateStagedManifests(credentials) {
  const chromiumManifestPath = resolve(distDir, 'chromium', 'manifest.json');
  const firefoxManifestPath = resolve(distDir, 'firefox', 'manifest.json');
  const chromium = loadJson(chromiumManifestPath);
  const firefox = loadJson(firefoxManifestPath);

  chromium.update_url = credentials.hosting.chromiumUpdateUrl;
  firefox.browser_specific_settings = {
    ...(firefox.browser_specific_settings ?? {}),
    gecko: {
      ...(firefox.browser_specific_settings?.gecko ?? {}),
      id: credentials.signing.firefox.geckoId,
      update_url: credentials.hosting.firefoxUpdateUrl,
    },
  };

  writeJson(chromiumManifestPath, chromium);
  writeJson(firefoxManifestPath, firefox);
  return { version: requiredString(chromium.version, 'apps/extension/manifest.json version') };
}

function signFirefox(sourceDir, outFile, credentials) {
  const artifactsDir = dirname(outFile);
  rmSync(artifactsDir, { recursive: true, force: true });
  mkdirSync(artifactsDir, { recursive: true });

  run('web-ext', [
    'sign',
    '--channel=unlisted',
    '--source-dir',
    sourceDir,
    '--artifacts-dir',
    artifactsDir,
    '--api-key',
    credentials.signing.firefox.amoJwtIssuer,
    '--api-secret',
    credentials.signing.firefox.amoJwtSecret,
  ]);

  const xpi = readdirSync(artifactsDir)
    .filter((name) => name.endsWith('.xpi'))
    .sort()
    .at(-1);
  if (!xpi) fail('web-ext sign completed but no .xpi artifact was produced.');

  const signedPath = resolve(artifactsDir, xpi);
  if (signedPath !== outFile) {
    copyFileSync(signedPath, outFile);
  }
}

function writeUpdateMetadata(paths, credentials, ids, version) {
  const chromiumCrxUrl = appUrl(credentials.hosting, `chromium/focuslock-${version}.crx`);
  const updatesXml = `<?xml version='1.0' encoding='UTF-8'?>
<gupdate xmlns='http://www.google.com/update2/response' protocol='2.0'>
  <app appid='${ids.chromium}'>
    <updatecheck codebase='${chromiumCrxUrl}' version='${version}' />
  </app>
</gupdate>
`;

  const updatesJson = {
    addons: {
      [ids.firefox]: {
        updates: [
          {
            version,
            update_link: credentials.hosting.firefoxXpiUrl,
          },
        ],
      },
    },
  };

  writeFileSync(paths.chromiumUpdatesXml, updatesXml);
  writeJson(paths.firefoxUpdatesJson, updatesJson);
  writeJson(paths.idsJson, ids);
}

function upload(path, s3Uri, contentType, cacheControl, credentials) {
  run(
    'aws',
    [
      's3',
      'cp',
      path,
      s3Uri,
      '--region',
      credentials.aws.region,
      '--content-type',
      contentType,
      '--cache-control',
      cacheControl,
    ],
    {
      env: {
        AWS_ACCESS_KEY_ID: credentials.aws.accessKeyId,
        AWS_SECRET_ACCESS_KEY: credentials.aws.secretAccessKey,
        AWS_DEFAULT_REGION: credentials.aws.region,
      },
    },
  );
}

function main() {
  const credentials = loadCredentials();

  run('node', ['scripts/build-extension.mjs']);
  rmSync(releaseDir, { recursive: true, force: true });
  mkdirSync(resolve(releaseDir, 'chromium'), { recursive: true });
  mkdirSync(resolve(releaseDir, 'firefox'), { recursive: true });

  const { version } = updateStagedManifests(credentials);
  assertUrl(
    'extension_hosting.chromium_update_url',
    credentials.hosting.chromiumUpdateUrl,
    appUrl(credentials.hosting, 'chromium/updates.xml'),
  );
  assertUrl(
    'extension_hosting.firefox_update_url',
    credentials.hosting.firefoxUpdateUrl,
    appUrl(credentials.hosting, 'firefox/updates.json'),
  );
  assertUrl(
    'extension_hosting.firefox_xpi_url',
    credentials.hosting.firefoxXpiUrl,
    appUrl(credentials.hosting, `firefox/focuslock-${version}.xpi`),
  );

  const chromiumKeyPath = resolve(root, credentials.signing.chromium.privateKeyPath);
  const chromiumIdentity = readChromiumIdentity(chromiumKeyPath);
  if (chromiumIdentity.extensionId !== credentials.signing.chromium.expectedExtensionId) {
    fail(
      `Chromium extension id ${chromiumIdentity.extensionId} does not match expected ${credentials.signing.chromium.expectedExtensionId}`,
    );
  }

  const paths = {
    chromiumCrx: resolve(releaseDir, 'chromium', `focuslock-${version}.crx`),
    chromiumUpdatesXml: resolve(releaseDir, 'chromium', 'updates.xml'),
    firefoxXpi: resolve(releaseDir, 'firefox', `focuslock-${version}.xpi`),
    firefoxUpdatesJson: resolve(releaseDir, 'firefox', 'updates.json'),
    idsJson: resolve(releaseDir, 'ids.json'),
  };

  createCrx(resolve(distDir, 'chromium'), paths.chromiumCrx, chromiumIdentity);
  if (skipFirefoxSign) {
    console.warn('Skipping Firefox signing; writing an unsigned placeholder XPI for local checks.');
    writeFileSync(paths.firefoxXpi, zipDirectory(resolve(distDir, 'firefox')));
  } else {
    signFirefox(resolve(distDir, 'firefox'), paths.firefoxXpi, credentials);
  }

  const ids = {
    chromium: chromiumIdentity.extensionId,
    firefox: credentials.signing.firefox.geckoId,
  };
  writeUpdateMetadata(paths, credentials, ids, version);

  if (!skipUpload) {
    const bucket = credentials.hosting.bucket;
    upload(
      paths.chromiumCrx,
      `s3://${bucket}/ext/chromium/focuslock-${version}.crx`,
      'application/x-chrome-extension',
      'public,max-age=31536000,immutable',
      credentials,
    );
    upload(
      paths.chromiumUpdatesXml,
      `s3://${bucket}/ext/chromium/updates.xml`,
      'application/xml',
      'no-cache',
      credentials,
    );
    upload(
      paths.firefoxXpi,
      `s3://${bucket}/ext/firefox/focuslock-${version}.xpi`,
      'application/x-xpinstall',
      'public,max-age=31536000,immutable',
      credentials,
    );
    upload(
      paths.firefoxUpdatesJson,
      `s3://${bucket}/ext/firefox/updates.json`,
      'application/json',
      'no-cache',
      credentials,
    );
  }

  console.log('\nRelease artifacts:');
  for (const path of Object.values(paths)) {
    console.log(`  ${relative(root, path)}`);
  }
  console.log('\nNative policy URLs:');
  console.log(`  Chromium: ${credentials.hosting.chromiumUpdateUrl}`);
  console.log(`  Firefox:  ${credentials.hosting.firefoxXpiUrl}`);
}

main();
