// TEMP (design refresh review) — deleted after use.
import { _electron as electron } from '@playwright/test';
import { mkdtemp, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { dress, seedFixture } from './lib/marketing-capture.mjs';
const [,, outRoot, shotDir, tag] = process.argv;
const userDataDir = await mkdtemp(join(tmpdir(), 'talysman-capture-'));
await writeFile(join(userDataDir, 'onboarding.json'), JSON.stringify({ complete: true, completedAt: new Date().toISOString(), version: 1 }));
await mkdir(shotDir, { recursive: true });
const app = await electron.launch({ args: [join(outRoot, 'main/index.cjs'), `--user-data-dir=${userDataDir}`, '--ozone-platform=x11', '--disable-gpu'] });
const win = await app.firstWindow();
await win.getByText('Connecting…').waitFor({ state: 'detached' });
const info = await win.evaluate(() => window.api.appInfo());
if (!info.usingMock) { await app.close(); throw new Error('not mock'); }
const cdp = await app.context().newCDPSession(win);
await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1180, height: 820, deviceScaleFactor: 1, mobile: false });
await dress(win);
await seedFixture(win);
const snap = async (n) => { await win.waitForTimeout(450); await win.screenshot({ path: join(shotDir, `${tag}-${n}.png`) }); console.log('ok', n); };
await snap('dashboard-off');
for (const r of ['Stats', 'Blocklists', 'Schedule', 'Keys', 'Account', 'Settings']) {
  await win.getByRole('button', { name: r, exact: true }).first().click();
  await snap(r.toLowerCase());
}
await win.getByRole('button', { name: 'Dashboard', exact: true }).click();
try {
  await win.evaluate(() => window.api.devToggleKey());
  await win.getByRole('button', { name: 'Turn on focus' }).click({ timeout: 3000 });
  const c = win.getByRole('button', { name: /turn on|confirm|start/i }).last();
  await win.waitForTimeout(400);
  await snap('dashboard-arming');
  if (await c.isVisible()) await c.click({ timeout: 2000 }).catch(() => {});
  await snap('dashboard-on');
  await win.getByRole('button', { name: /Deep work/ }).first().click({ timeout: 2000 });
  await snap('modes-modal');
} catch (e) { console.log('focus flow warn', e.message.split('\n')[0]); }
await app.close();
