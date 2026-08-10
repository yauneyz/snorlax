#!/usr/bin/env node
/**
 * Exploratory pass — screenshots of every page against the mock service.
 */
import { _electron as electron } from '@playwright/test';
import { mkdtemp, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const MAIN = resolve(ROOT, 'apps/desktop/out/main/index.cjs');
const OUT = process.env.SHOT_OUT ?? resolve(ROOT, '.marketing-shots');

const userDataDir = await mkdtemp(join(tmpdir(), 'talysman-shots-'));
await writeFile(
  join(userDataDir, 'onboarding.json'),
  JSON.stringify({ complete: true, completedAt: new Date().toISOString(), version: 1 }),
);
await mkdir(OUT, { recursive: true });

const app = await electron.launch({ args: [MAIN, `--user-data-dir=${userDataDir}`] });
const win = await app.firstWindow();
await win.getByText('Connecting…').waitFor({ state: 'detached' });

console.log('appInfo', await win.evaluate(() => window.api.appInfo()));
console.log('entitlement', await win.evaluate(() => window.api.entitlement()));

await win.screenshot({ path: join(OUT, '00-dashboard.png') });

for (const route of ['Blocklists', 'Schedule', 'Keys', 'Account', 'Settings']) {
  await win.getByRole('button', { name: route }).click();
  await win.waitForTimeout(400);
  await win.screenshot({ path: join(OUT, `00-${route.toLowerCase()}.png`) });
}

await app.close();
console.log('done ->', OUT);
