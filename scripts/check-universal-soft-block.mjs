#!/usr/bin/env node
/* global universalRequests, universalListeners, resolveUniversal, document, getComputedStyle */
// Browser regression checks against synthetic pages. No external website or AI endpoint is used.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { chromium } from '@playwright/test';

const executablePath = process.env.CHROME_PATH || execFileSync('which', ['google-chrome-stable'], { encoding: 'utf8' }).trim();
const browser = await chromium.launch({ executablePath, headless: true });
try {
  const context = await browser.newContext();
  const errors = [];
  const page = await context.newPage();
  page.on('pageerror', (error) => errors.push(error.message));
  const helpers = readFileSync(new URL('../apps/extension/src/universal-dom.js', import.meta.url), 'utf8').replace(/^export /gm, '');
  const content = readFileSync(new URL('../apps/extension/src/universal-content.js', import.meta.url), 'utf8').replace(/^import .*;\n/gm, '');
  await page.addInitScript({ content: `
    globalThis.universalRequests = [];
    globalThis.universalListeners = [];
    globalThis.chrome = { runtime: {
      onMessage: { addListener(fn) { universalListeners.push(fn); } },
      async sendMessage(message) {
        if (message.type === 'talysman:universal-policy') return { enabled: true };
        universalRequests.push(message);
        return new Promise(resolve => { globalThis.resolveUniversal = resolve; });
      }
    }};
    ${helpers}
    ${content}
  ` });
  const recommendations = '<aside id="related"><h2>Recommended</h2><div class="card"><a>One</a><span>Read</span></div><div class="card"><a>Two</a><span>Read</span></div></aside>';
  const fixture = `<!doctype html><html><head><title>Article</title></head><body>
    <header><form><input type="search" value="private query"></form></header>
    <main><article id="story"><h1>Primary article</h1><p>${'Useful content. '.repeat(80)}</p></article>${recommendations}</main>
    <form id="compose"><textarea>private draft</textarea></form>
    </body></html>`;
  await page.route('https://fixture.test/**', (route) => route.fulfill({ contentType: 'text/html', body: fixture }));
  await page.goto('https://fixture.test/article/123');
  await page.waitForFunction(() => universalRequests.length === 1);
  // A pending model response never delays navigation or hides the page.
  assert.equal(await page.evaluate(() => document.readyState), 'complete');
  assert.equal(await page.locator('#related').isVisible(), true);
  assert.equal(await page.locator('#story').isVisible(), true);
  const summary = await page.evaluate(() => universalRequests[0].content);
  assert(!summary.includes('private query'));
  assert(!summary.includes('private draft'));
  assert(!summary.includes('Useful content.'));
  await page.evaluate(() => {
    const summary = JSON.parse(universalRequests[0].content);
    resolveUniversal({ regions: summary.regions.filter((r) => r.id !== undefined && r.tag === 'aside').map((r) => r.id) });
  });
  await page.waitForFunction(() => getComputedStyle(document.querySelector('#related')).display === 'none');
  assert.equal(await page.locator('#story').isVisible(), true);
  assert.equal(await page.locator('#compose').isVisible(), true);
  // React replacing the nodes with identical markup must rebind the cached IDs locally.
  await page.evaluate((markup) => { document.querySelector('#related').outerHTML = markup; }, recommendations);
  await page.waitForFunction(() => getComputedStyle(document.querySelector('#related')).display === 'none');
  // Hidden regions drop out of later summaries, so a follow-up request may be outstanding; it
  // must not include the hidden aside.
  assert(await page.evaluate(() => universalRequests.slice(1).every((r) => !r.content.includes('"related"'))));
  // A feed region may hold video and forms; only the page shell and navigation are off limits.
  const summaryRegions = await page.evaluate(() => JSON.parse(universalRequests[0].content).regions);
  assert(!summaryRegions.some((r) => r.tag === 'body' || r.tag === 'header'));
  // Disabled rules restore all hidden elements, including while a request is outstanding.
  await page.evaluate(() => universalListeners.forEach((fn) => fn({ type: 'talysman:universal-policy', enabled: false })));
  assert.equal(await page.locator('#related').isVisible(), true);
  assert.equal(await page.locator('#story').isVisible(), true);
  assert.deepEqual(errors, []);
  console.log('OK Universal browser checks: normal page load, bounded extraction excluding form values and article prose, delayed hiding, primary content preservation, DOM replacement, shell/navigation exclusion, and disable cleanup.');
} finally {
  await browser.close();
}
