/**
 * Stages the real artifacts the compositions show into public/ (gitignored):
 *
 *  - the extension's block page, from its build (apps/extension/dist/chrome), without its script —
 *    it talks to the extension runtime, which a composition doesn't have; the page's default
 *    copy is what someone sees when they hit a blocked site;
 *  - the landing page's browser captures of real sites with the extension's site rules applied.
 *
 *   pnpm --filter @talysman/motion assets   (also run by `studio` and `render`)
 */
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '../../..');
const PUBLIC = resolve(HERE, '../public');
const EXTENSION = resolve(ROOT, 'apps/extension/dist/chrome');
const MEDIA = resolve(ROOT, 'apps/web/public/media');

export function stageAssets(): void {
  if (!existsSync(resolve(EXTENSION, 'blocked.html'))) {
    throw new Error(`no extension build at ${EXTENSION}; run pnpm build:extension`);
  }
  mkdirSync(resolve(PUBLIC, 'extension'), { recursive: true });
  const html = readFileSync(resolve(EXTENSION, 'blocked.html'), 'utf8').replace(/<script[^>]*><\/script>\s*/g, '');
  writeFileSync(resolve(PUBLIC, 'extension/blocked.html'), html);
  for (const file of ['blocked.css', 'blocked-logo.svg']) {
    copyFileSync(resolve(EXTENSION, file), resolve(PUBLIC, 'extension', file));
  }

  mkdirSync(resolve(PUBLIC, 'media'), { recursive: true });
  for (const file of ['browser-reddit-no-feed.png', 'browser-instagram-no-feed.png']) {
    copyFileSync(resolve(MEDIA, file), resolve(PUBLIC, 'media', file));
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  stageAssets();
  console.log(`staged → ${PUBLIC}`);
}
