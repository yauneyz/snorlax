#!/usr/bin/env tsx
// Snapshots real pages of catalog sites so `pnpm check:sites` can test their selectors offline.
//
//   pnpm capture:sites facebook [tiktok …]   # or --all
//   pnpm capture:sites facebook --headless   # once the profile is signed in
//
// Each site gets its own persistent Chrome profile (see site-captures.ts). The first run opens a
// window: sign in there and the capture carries on by itself. Starting from the site's
// `captureSeeds`, it follows links on captured pages until every configurable feature has a
// page (or it runs out of links), and replaces that site's previous captures.

import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { chromium, type BrowserContext, type Page } from '@playwright/test';
import { SITE_DEFINITIONS, type SiteDefinition } from '../packages/shared/src/sites/index.js';
import { classifyUrl } from '../apps/extension/src/site-engine.js';
import { capturesDir, chromePath, profilesDir, type CaptureMeta } from './lib/site-captures.js';

const MAX_PAGES = 30;
const SIGN_IN_TIMEOUT_MS = 10 * 60_000;

const args = process.argv.slice(2);
const headless = args.includes('--headless');
const ids = args.filter((arg) => !arg.startsWith('--'));
const sites = args.includes('--all') ? SITE_DEFINITIONS : ids.map((id) => {
  const site = SITE_DEFINITIONS.find((s) => s.id === id);
  if (!site) throw new Error(`unknown site ${id}; known: ${SITE_DEFINITIONS.map((s) => s.id).join(', ')}`);
  return site;
});
if (sites.length === 0) {
  console.error('usage: pnpm capture:sites <site…> | --all [--headless]');
  process.exit(2);
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function isLocked(site: SiteDefinition, feature: string | undefined): boolean {
  return !!site.features.find((f) => f.id === feature)?.locked;
}

/** Bounced to a sign-in flow, or shown a login form in place of the page. */
async function signInWall(page: Page, site: SiteDefinition, requestedFeature: string): Promise<boolean> {
  if (isLocked(site, requestedFeature)) return false;
  const now = classifyUrl(page.url());
  if (now?.site === site.id && isLocked(site, now.feature)) return true;
  return (await page.locator('input[type="password"]:visible').count()) > 0;
}

async function ensureSignedIn(page: Page, site: SiteDefinition, url: string, requestedFeature: string): Promise<void> {
  if (!(await signInWall(page, site, requestedFeature))) return;
  if (headless) throw new Error(`${site.label} needs a sign-in; run once without --headless and sign in in the window`);
  console.log(`  → Sign in to ${site.label} in the Chrome window. Waiting up to 10 minutes…`);
  const deadline = Date.now() + SIGN_IN_TIMEOUT_MS;
  while (await signInWall(page, site, requestedFeature)) {
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${site.label} sign-in`);
    await sleep(2000);
  }
  console.log('  → Signed in, continuing.');
  await sleep(3000);
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45_000 });
}

/** Let the app render, and scroll so infinite feeds load a few items and lazy rails appear. */
async function settle(page: Page): Promise<void> {
  await page.locator('main, [role="main"]').first().waitFor({ timeout: 15_000 }).catch(() => {});
  await sleep(2500);
  for (let i = 0; i < 3; i += 1) {
    await page.mouse.wheel(0, 900);
    await sleep(1200);
  }
  await page.evaluate(() => window.scrollTo(0, 0));
  await sleep(1000);
}

/**
 * The page's DOM without scripts, open shadow roots included (as declarative shadow DOM), plus
 * every link on it. Offline checks run with JS off, so what matters is the rendered markup.
 */
async function snapshot(page: Page): Promise<{ html: string; links: string[] }> {
  return page.evaluate(() => {
    const links = Array.from(document.querySelectorAll('a[href]'), (a) => (a as HTMLAnchorElement).href);
    const roots: ShadowRoot[] = [];
    const walk = (root: Document | ShadowRoot) => {
      for (const el of root.querySelectorAll('*')) {
        if (el.shadowRoot) {
          roots.push(el.shadowRoot);
          walk(el.shadowRoot);
        }
      }
    };
    walk(document);
    for (const root of [document, ...roots]) {
      for (const el of root.querySelectorAll('script, link[rel="preload"], link[rel="modulepreload"], link[rel="prefetch"]')) el.remove();
    }
    const root = document.documentElement as HTMLElement & { getHTML?: (options: object) => string };
    const html = root.getHTML ? root.getHTML({ serializableShadowRoots: true, shadowRoots: roots }) : root.innerHTML;
    return { html: `<!doctype html><html lang="${document.documentElement.lang}">${html}</html>`, links };
  });
}

async function launch(site: SiteDefinition): Promise<BrowserContext> {
  const context = await chromium.launchPersistentContext(path.join(profilesDir, site.id), {
    executablePath: chromePath(),
    headless,
    viewport: { width: 1440, height: 900 },
    locale: 'en-US',
    args: ['--disable-blink-features=AutomationControlled'],
  });
  // tsx's esbuild wraps named functions in a `__name()` helper; page.evaluate callbacks need it too.
  await context.addInitScript('globalThis.__name = (fn) => fn;');
  return context;
}

async function captureSite(site: SiteDefinition): Promise<void> {
  const dir = path.join(capturesDir, site.id);
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  let context = await launch(site);
  let page = context.pages()[0] ?? (await context.newPage());
  const watch = (p: Page) => {
    p.on('crash', () => console.log('    the tab crashed'));
    p.on('close', () => console.log('    the tab closed'));
  };
  watch(page);
  // Some pages take the browser down with them (Facebook's /reel/ closes its own tab and Chrome
  // exits). The profile keeps the sign-in, so relaunch and carry on.
  const freshPage = async () => {
    try {
      page = await context.newPage();
    } catch {
      console.log('    the browser exited; relaunching');
      await context.close().catch(() => {});
      context = await launch(site);
      page = context.pages()[0] ?? (await context.newPage());
    }
    watch(page);
  };

  const home = `https://${site.appHosts.find((host) => host.startsWith('www.')) ?? site.appHosts[0]}/`;
  const queue: { url: string; source: string }[] = (site.captureSeeds ?? [home]).map((url) => ({ url, source: 'seed' }));
  const visited = new Set<string>();
  const captured = new Map<string, number>();
  const discovered: { url: string; feature: string; source: string }[] = [];
  const wanted = site.features.filter((f) => !f.locked).map((f) => f.id);
  let count = 0;

  const capture = async (url: string, source: string) => {
    const requested = classifyUrl(url);
    if (!requested || requested.site !== site.id || visited.has(url)) return;
    visited.add(url);
    console.log(`  ${url}`);
    if (page.isClosed()) await freshPage();
    try {
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45_000 });
      await ensureSignedIn(page, site, url, requested.feature);
      await settle(page);
    } catch (error) {
      console.log(`    skipped: ${(error as Error).message.split('\n')[0]}`);
      if (/sign-in/.test((error as Error).message)) throw error;
      return;
    }
    const final = classifyUrl(page.url());
    if (!final || final.site !== site.id) {
      console.log(`    skipped: left the site (${page.url()})`);
      return;
    }
    const { html, links } = await snapshot(page);
    const aria = await page.locator('body').ariaSnapshot({ timeout: 20_000 }).catch(() => '');
    count += 1;
    const base = `${String(count).padStart(2, '0')}-${final.feature}`;
    const meta: CaptureMeta = { site: site.id, feature: final.feature, requestedUrl: url, finalUrl: page.url(), capturedAt: new Date().toISOString(), source };
    writeFileSync(path.join(dir, `${base}.html`), html);
    writeFileSync(path.join(dir, `${base}.json`), JSON.stringify(meta, null, 2) + '\n');
    if (aria) writeFileSync(path.join(dir, `${base}.aria.yml`), aria);
    captured.set(final.feature, (captured.get(final.feature) ?? 0) + 1);
    console.log(`    saved ${base} (${Math.round(html.length / 1024)} KB, ${links.length} links)`);
    for (const link of links) {
      const target = classifyUrl(link);
      if (target?.site === site.id && !isLocked(site, target.feature)) discovered.push({ url: link.split('#')[0], feature: target.feature, source: `link on ${base}` });
    }
    await sleep(1500 + Math.random() * 2000);
  };

  for (const { url, source } of queue) await capture(url, source);
  // Follow links until every configurable feature has a page.
  while (count < MAX_PAGES) {
    const next = discovered.find((d) => !captured.has(d.feature) && !visited.has(d.url));
    if (!next) break;
    await capture(next.url, next.source);
  }
  await context.close();
  const missing = wanted.filter((feature) => !captured.has(feature));
  console.log(`  ${count} pages → ${dir}`);
  if (missing.length > 0) console.log(`  no page found for: ${missing.join(', ')} (add a captureSeed if it has pages)`);
}

async function main(): Promise<void> {
  for (const site of sites) {
    console.log(`${site.label}:`);
    await captureSite(site);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
