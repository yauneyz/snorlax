#!/usr/bin/env tsx
// Renders the browser-extension store promo images from the brand kit and the store screenshots:
//
//   - promo-small-440x280.jpg     Chrome Web Store small promo tile
//   - promo-marquee-1400x560.jpg  Chrome Web Store marquee promo tile
//
//   pnpm capture:store-promos     (also run at the end of pnpm capture:store)
//
// Laid out in HTML and rendered by headless Chromium, so the type is the site's Space Grotesk and
// the colours come from the shared palette. The marquee reuses the screenshots in
// assets/store-screenshots, so run `pnpm capture:store` first if those are stale.
//
// Output → assets/store-screenshots (override with CAPTURE_OUT).

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { chromium, type Browser } from '@playwright/test';
import { readPalette } from './lib/palette.mjs';
import { repoRoot } from './lib/site-captures.js';

const OUT = process.env.CAPTURE_OUT ?? path.join(repoRoot, 'assets/store-screenshots');
const { colors } = readPalette();

const dataUrl = (file: string, type: string) =>
  `data:${type};base64,${readFileSync(file).toString('base64')}`;

const FONT = dataUrl(
  path.join(repoRoot, 'apps/desktop/node_modules/@fontsource-variable/space-grotesk/files/space-grotesk-latin-wght-normal.woff2'),
  'font/woff2',
);
const MARK = dataUrl(path.join(repoRoot, 'assets/brand/source/talysman-mark.svg'), 'image/svg+xml');
const shot = (name: string) => dataUrl(path.join(OUT, `${name}.png`), 'image/png');

const BASE_CSS = `
  @font-face { font-family: 'Space Grotesk'; src: url(${FONT}) format('woff2'); font-weight: 300 700; }
  * { box-sizing: border-box; margin: 0; }
  html, body { width: 100%; height: 100%; overflow: hidden; }
  body {
    position: relative;
    font-family: 'Space Grotesk', sans-serif;
    color: ${colors.foregroundStrong};
    background:
      radial-gradient(ellipse at 18% 30%, rgb(217 255 99 / .08), transparent 55%),
      radial-gradient(ellipse at 85% 110%, rgb(199 204 212 / .07), transparent 60%),
      ${colors.background};
    -webkit-font-smoothing: antialiased;
  }
  .brand { display: flex; align-items: center; }
  .wordmark { font-weight: 600; letter-spacing: .32em; text-transform: uppercase; color: ${colors.brand}; }
  h1 { font-weight: 700; letter-spacing: -.035em; line-height: 1.02; }
  h1 span { color: ${colors.signal}; }
  .frame {
    position: absolute;
    overflow: hidden;
    border-radius: 12px;
    border: 1px solid rgb(255 255 255 / .12);
    box-shadow: 0 30px 80px rgb(0 0 0 / .65);
    background: ${colors.panel};
  }
  .frame img { display: block; width: 100%; height: 100%; object-fit: cover; object-position: left top; }
`;

/** 440x280. Little room: the mark, the name, and the one idea. */
const SMALL = `
  <style>
    .brand { gap: 14px; position: absolute; left: 36px; top: 34px; }
    .brand img { width: 46px; height: 46px; }
    .wordmark { font-size: 17px; }
    h1 { position: absolute; left: 36px; bottom: 40px; font-size: 44px; }
  </style>
  <div class="brand"><img src="${MARK}" alt=""><span class="wordmark">Talysman</span></div>
  <h1>Hide the feed.<br><span>Keep the site.</span></h1>
`;

/** 1400x560. Copy on the left; the extension at work on the right. */
const MARQUEE = `
  <style>
    .copy { position: absolute; left: 80px; top: 0; bottom: 0; width: 560px; display: flex; flex-direction: column; justify-content: center; }
    .brand { gap: 16px; margin-bottom: 34px; }
    .brand img { width: 52px; height: 52px; }
    .wordmark { font-size: 19px; }
    h1 { font-size: 68px; }
    p { margin-top: 24px; font-size: 21px; line-height: 1.45; color: ${colors.foregroundSoft}; max-width: 500px; }
    .reddit { left: 700px; top: 56px; width: 640px; height: 400px; }
    /* Cropped to the blocked page's card: in the 1280x800 shot it sits at roughly (340,132)–(940,668). */
    .blocked { left: 630px; top: 236px; width: 330px; height: 290px; background: ${colors.background}; }
    .blocked img { position: absolute; width: 640px; height: 400px; left: -150px; top: -50px; object-fit: fill; }
    .tag {
      position: absolute; left: 1010px; top: 190px; display: flex; align-items: center; gap: 10px;
      padding: 10px 18px; border-radius: 999px; font-size: 17px; font-weight: 600;
      color: ${colors.signalInk}; background: ${colors.signal}; box-shadow: 0 12px 30px rgb(0 0 0 / .5);
    }
    .tag i { width: 8px; height: 8px; border-radius: 50%; background: ${colors.signalInk}; }
  </style>
  <div class="copy">
    <div class="brand"><img src="${MARK}" alt=""><span class="wordmark">Talysman</span></div>
    <h1>Hide the feed.<br><span>Keep the site.</span></h1>
    <p>Strip the algorithmic feeds from Reddit, Instagram and YouTube, and block the sites that eat your day.</p>
  </div>
  <div class="frame reddit"><img src="${shot('extension-reddit-no-feed')}" alt=""></div>
  <div class="tag"><i></i>Feed hidden</div>
  <div class="frame blocked"><img src="${shot('extension-blocked-page')}" alt=""></div>
`;

async function render(browser: Browser, name: string, width: number, height: number, body: string) {
  const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: 1 });
  await page.setContent(`<!doctype html><html><head><style>${BASE_CSS}</style></head><body>${body}</body></html>`, {
    waitUntil: 'load',
  });
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({ path: path.join(OUT, `${name}.jpg`), type: 'jpeg', quality: 92 });
  await page.close();
  console.log(`  ✓ ${name}.jpg`);
}

async function main(): Promise<void> {
  console.log('rendering store promo tiles…');
  const browser = await chromium.launch();
  try {
    await render(browser, 'promo-small-440x280', 440, 280, SMALL);
    await render(browser, 'promo-marquee-1400x560', 1400, 560, MARQUEE);
  } finally {
    await browser.close();
  }
  console.log(`done → ${OUT}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
