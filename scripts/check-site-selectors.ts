#!/usr/bin/env tsx
// Tests the catalog's element selectors and `keep` anchors against pages captured by
// `pnpm capture:sites`, in headless Chrome with JS and the network off.
//
//   pnpm check:sites [site…]
//
// Errors (exit 1):
//   - a feature hides nothing on its own page (the site-rule contract, checked on real markup)
//   - another feature's element covers a `keep` anchor, or the page's main landmark
//   - a `keep` anchor matches nothing in any capture it applies to (the anchor went stale)
//   - an invalid selector
// Warnings: selectors that never matched on any capture they applied to, and lint findings.

import { chromium, type Page } from '@playwright/test';
import { SITE_DEFINITIONS, type SiteDefinition } from '../packages/shared/src/sites/index.js';
import { classifyUrl } from '../apps/extension/src/site-engine.js';
import { lintSelector } from './lib/site-catalog.js';
import { chromePath, readCaptures, type Capture } from './lib/site-captures.js';

interface PageResult {
  /** Match count per element index; -1 = not applicable on this page, -2 = invalid selector. */
  matches: number[];
  /** Per keep index: anchors found (-1 = not applicable). */
  keeps: number[];
  /** [keep index, element index] pairs where the element covers the anchor. */
  covered: [number, number][];
  /** Element indexes that cover the main landmark though they belong to another feature. */
  coversMain: number[];
}

/** Runs in the page. Mirrors site-content.js: an element applies when `on` includes the page's feature. */
function inspect({ feature, elements, keeps }: { feature: string; elements: { feature: string; selector: string; on?: string[] }[]; keeps: { selector: string; feature?: string; on?: string[] }[] }): PageResult {
  const applies = (on?: string[]) => !on || on.includes(feature);
  const matched: Element[][] = elements.map(() => []);
  const matches = elements.map((element, index) => {
    if (!applies(element.on)) return -1;
    try {
      matched[index] = Array.from(document.querySelectorAll(element.selector));
      return matched[index].length;
    } catch {
      return -2;
    }
  });
  const covers = (hider: Element, target: Element) => hider === target || hider.contains(target);
  const covered: [number, number][] = [];
  const keepCounts = keeps.map((keep, k) => {
    if (!applies(keep.on)) return -1;
    let anchors: Element[] = [];
    try {
      anchors = Array.from(document.querySelectorAll(keep.selector));
    } catch {
      return -2;
    }
    elements.forEach((element, e) => {
      if (element.feature === keep.feature) return;
      if (matched[e].some((hider) => anchors.some((anchor) => covers(hider, anchor)))) covered.push([k, e]);
    });
    return anchors.length;
  });
  const landmarks = Array.from(document.querySelectorAll('main, [role="main"]'));
  const coversMain = elements
    .map((element, e) => (element.feature !== feature && matched[e].some((hider) => landmarks.some((main) => covers(hider, main))) ? e : -1))
    .filter((e) => e >= 0);
  return { matches, keeps: keepCounts, covered, coversMain };
}

const ids = process.argv.slice(2).filter((arg) => !arg.startsWith('--'));
const sites = ids.length > 0 ? SITE_DEFINITIONS.filter((site) => ids.includes(site.id)) : SITE_DEFINITIONS;

let errors = 0;
let warnings = 0;
let checked = 0;

async function checkSite(page: Page, site: SiteDefinition, captures: Capture[]): Promise<void> {
  const keeps = site.keep ?? [];
  const lines: string[] = [];
  const error = (message: string) => {
    errors += 1;
    lines.push(`  ✘ ${message}`);
  };
  const warn = (message: string) => {
    warnings += 1;
    lines.push(`  ⚠ ${message}`);
  };
  const describe = (e: number) => `${site.elements[e].feature} \`${site.elements[e].selector}\``;

  const applied = site.elements.map(() => 0);
  const hit = site.elements.map(() => 0);
  const keepApplied = keeps.map(() => 0);
  const keepHit = keeps.map(() => 0);

  for (const capture of captures) {
    // Classify with today's catalog, so a routing change is checked without re-capturing.
    const feature = classifyUrl(capture.meta.finalUrl)?.feature ?? capture.meta.feature;
    const name = capture.file.split('/').pop();
    await page.setContent(capture.html, { waitUntil: 'domcontentloaded' });
    const arg = JSON.stringify({ feature, elements: site.elements, keeps });
    // Passed as source: tsx's esbuild wraps named functions in a `__name()` helper the page lacks.
    const result: PageResult = await page.evaluate(`(() => { const __name = (fn) => fn; return (${inspect.toString()})(${arg}); })()`);

    result.matches.forEach((count, e) => {
      if (count === -2) error(`${name}: invalid selector ${describe(e)}`);
      if (count < 0) return;
      applied[e] += 1;
      if (count > 0) hit[e] += 1;
    });
    const locked = site.features.find((f) => f.id === feature)?.locked;
    const own = site.elements.map((element, e) => [element, e] as const).filter(([element]) => element.feature === feature && (!element.on || element.on.includes(feature)));
    if (!locked && own.length > 0 && own.every(([, e]) => result.matches[e] <= 0)) {
      error(`${name} (${capture.meta.finalUrl}): hiding "${feature}" hides nothing on its own page`);
    }
    result.keeps.forEach((count, k) => {
      if (count === -2) error(`${name}: invalid keep selector "${keeps[k].name}"`);
      if (count < 0) return;
      keepApplied[k] += 1;
      if (count > 0) keepHit[k] += 1;
      else if (keeps[k].on) warn(`${name}: keep "${keeps[k].name}" not found on a ${feature} page`);
    });
    for (const [k, e] of result.covered) error(`${name}: ${describe(e)} covers keep "${keeps[k].name}"`);
    for (const e of result.coversMain) error(`${name}: ${describe(e)} covers the page's main content on a ${feature} page`);
  }

  site.elements.forEach((element, e) => {
    if (applied[e] > 0 && hit[e] === 0) warn(`${describe(e)} matched nothing on ${applied[e]} page(s) it applies to`);
    for (const finding of lintSelector(element.selector)) warn(`${describe(e)}: ${finding.message}`);
  });
  keeps.forEach((keep, k) => {
    if (keepApplied[k] > 0 && keepHit[k] === 0) error(`keep "${keep.name}" \`${keep.selector}\` matched nothing in any capture`);
  });

  const features = [...new Set(captures.map((c) => classifyUrl(c.meta.finalUrl)?.feature ?? c.meta.feature))];
  const untested = site.features.filter((f) => !f.locked && !features.includes(f.id)).map((f) => f.id);
  const unexercised = site.elements.filter((_, e) => applied[e] === 0).length;
  console.log(`${site.label}: ${captures.length} pages (${features.join(', ')})`);
  if (untested.length > 0) console.log(`  · no captured page for: ${untested.join(', ')}`);
  if (unexercised > 0) console.log(`  · ${unexercised} element rule(s) not exercised by any capture`);
  for (const line of lines) console.log(line);
}

async function main(): Promise<void> {
  const browser = await chromium.launch({ executablePath: chromePath(), headless: true });
  const context = await browser.newContext({ javaScriptEnabled: false, viewport: { width: 1440, height: 900 } });
  await context.route('**/*', (route) => route.abort());
  const page = await context.newPage();
  for (const site of sites) {
    const captures = readCaptures(site.id);
    if (captures.length === 0) continue;
    checked += 1;
    await checkSite(page, site, captures);
  }
  await browser.close();
  if (checked === 0) console.log('No captures found. Run `pnpm capture:sites <site>` first.');
  else console.log(`\n${errors} error(s), ${warnings} warning(s)`);
  process.exit(errors > 0 ? 1 : 0);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
