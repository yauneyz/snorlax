#!/usr/bin/env node
/**
 * Build the FocusLock browser extension into loadable, unpacked builds — one per engine, from the
 * shared source in apps/extension (architecture §13). No signing: this produces folders you can
 * load yourself (Chrome/Edge/Brave: "Load unpacked"; Firefox: about:debugging → Load Temporary
 * Add-on → pick manifest.json). Packing a signed CRX/XPI for force-install is a later, credentialed
 * step.
 *
 *   apps/extension/{manifest.json, src/}
 *      → apps/extension/dist/chromium   (manifest + a stable `key` so the id is fixed)
 *      → apps/extension/dist/firefox    (manifest + browser_specific_settings.gecko.id)
 *      → apps/desktop/resources/extension/{chromium,firefox}   (so the installer can ship them)
 *      → apps/extension/dist/ids.json   (the derived ids — paste the Chromium id into
 *                                        enforce::extension_policy::CHROMIUM_EXT_ID)
 *
 * The Chromium id is derived from a locally-generated RSA key (persisted at
 * apps/extension/keys/chromium.pem) so it's stable across builds and across "Load unpacked" and a
 * future packed CRX. The Firefox id is the fixed gecko id below.
 */

import crypto from 'node:crypto';
import {
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const extDir = resolve(root, 'apps/extension');
const srcDir = resolve(extDir, 'src');
const distDir = resolve(extDir, 'dist');
const keysDir = resolve(extDir, 'keys');
const resourcesDir = resolve(root, 'apps/desktop/resources/extension');

// MUST match enforce::extension_policy::FIREFOX_EXT_ID (native-host allowed_extensions + force-install).
const FIREFOX_ID = 'focuslock@focuslock.app';

/** Derive the Chromium extension id from the public key's SPKI DER (Chrome's algorithm). */
function chromiumId(spkiDer) {
  const hash = crypto.createHash('sha256').update(spkiDer).digest();
  let id = '';
  for (let i = 0; i < 16; i++) {
    id += String.fromCharCode(97 + (hash[i] >> 4)); // high nibble → a..p
    id += String.fromCharCode(97 + (hash[i] & 0x0f)); // low nibble  → a..p
  }
  return id;
}

/** Load the persisted Chromium key (generate + persist on first run). Returns {keyB64, id}. */
function chromiumKey() {
  mkdirSync(keysDir, { recursive: true });
  const pemPath = resolve(keysDir, 'chromium.pem');
  let privateKey;
  if (existsSync(pemPath)) {
    privateKey = crypto.createPrivateKey(readFileSync(pemPath, 'utf8'));
  } else {
    ({ privateKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 }));
    writeFileSync(pemPath, privateKey.export({ type: 'pkcs8', format: 'pem' }));
    console.log(`  generated Chromium signing key → ${pemPath} (keep it; it pins the id)`);
  }
  const spkiDer = crypto.createPublicKey(privateKey).export({ type: 'spki', format: 'der' });
  return { keyB64: spkiDer.toString('base64'), id: chromiumId(spkiDer) };
}

/**
 * Bundle rules.js + background.js into one import-free script. Chrome MV3 only allows
 * `background.service_worker` and Firefox (on many versions) only `background.scripts`, and a
 * classic Firefox background script can't use ES `import` — so we strip the `export`/`import`
 * keywords and concatenate, yielding a single file that works in both background shapes.
 */
function bundledBackground() {
  const rules = readFileSync(resolve(srcDir, 'rules.js'), 'utf8').replace(/^export\s+/gm, '');
  const bg = readFileSync(resolve(srcDir, 'background.js'), 'utf8').replace(
    /^\s*import\s+\{[^}]*\}\s+from\s+['"]\.\/rules\.js['"];?\s*$/m,
    '',
  );
  return (
    '// Built by scripts/build-extension.mjs — rules.js + background.js bundled (no ES imports),\n' +
    '// so one script works as a Chromium service worker and a Firefox background script.\n\n' +
    rules +
    '\n' +
    bg
  );
}

/** Stage one engine variant: write its manifest + bundled background.js, mirror into resources. */
function stageVariant(name, manifest, background) {
  const out = resolve(distDir, name);
  rmSync(out, { recursive: true, force: true });
  mkdirSync(out, { recursive: true });
  writeFileSync(resolve(out, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
  writeFileSync(resolve(out, 'background.js'), background);

  const res = resolve(resourcesDir, name);
  rmSync(res, { recursive: true, force: true });
  mkdirSync(res, { recursive: true });
  cpSync(out, res, { recursive: true });
  return out;
}

const base = JSON.parse(readFileSync(resolve(extDir, 'manifest.json'), 'utf8'));
delete base.background; // set per-engine below (service_worker vs scripts)
const background = bundledBackground();

// Chromium: service-worker background + a `key` so the id is stable for unpacked + packed installs.
const { keyB64, id: chromiumExtId } = chromiumKey();
const chromiumOut = stageVariant(
  'chromium',
  { ...base, key: keyB64, background: { service_worker: 'background.js' } },
  background,
);

// Firefox: classic `background.scripts` + a pinned gecko id (deterministic, no key needed).
const firefoxOut = stageVariant(
  'firefox',
  {
    ...base,
    browser_specific_settings: { gecko: { id: FIREFOX_ID, strict_min_version: '115.0' } },
    background: { scripts: ['background.js'] },
  },
  background,
);

writeFileSync(
  resolve(distDir, 'ids.json'),
  JSON.stringify({ chromium: chromiumExtId, firefox: FIREFOX_ID }, null, 2) + '\n',
);

console.log('\n✓ extension built (unpacked, unsigned):');
console.log(`    Chromium → ${chromiumOut}   id: ${chromiumExtId}`);
console.log(`    Firefox  → ${firefoxOut}   id: ${FIREFOX_ID}`);
console.log('\n  Load it:');
console.log('    Chrome/Edge/Brave: chrome://extensions → Developer mode → Load unpacked → dist/chromium');
console.log('    Firefox:           about:debugging → This Firefox → Load Temporary Add-on → dist/firefox/manifest.json');
console.log(
  `\n  For force-install/native-messaging, set enforce::extension_policy::CHROMIUM_EXT_ID = "${chromiumExtId}"`,
);
