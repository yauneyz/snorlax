import { test, expect } from '@playwright/test';
import { launchApp } from './launch.js';

test('blocked-site stats are opt-in, local-only, and deletable', async () => {
  const app = await launchApp();
  try {
    const win = await app.firstWindow();
    await win.getByText('Connecting…').waitFor({ state: 'detached' });
    const record = (host: string) => win.evaluate((h) => window.api.request('recordBlockedSite', { host: h }), host);

    await win.getByRole('button', { name: 'Stats', exact: true }).click();
    await expect(win.getByText('Focus by day')).toBeVisible();
    await expect(win.getByText(/Stored only on this computer\. Never sent to Talysman/)).toBeVisible();
    if (process.env.STATS_SCREENSHOT_DIR) await win.screenshot({ path: `${process.env.STATS_SCREENSHOT_DIR}/stats-off.png`, fullPage: true });

    // Visits before opting in are dropped.
    await record('reddit.com');
    await win.getByRole('button', { name: 'Turn on' }).click();
    await expect(win.getByText('Nothing blocked in the last 7 days.')).toBeVisible();

    for (const host of ['reddit.com', 'www.reddit.com', 'youtube.com']) await record(host);
    await win.getByRole('tab', { name: '30 days' }).click();
    await win.getByRole('tab', { name: '7 days' }).click();
    await win.reload();
    await win.getByText('Connecting…').waitFor({ state: 'detached' });
    await win.getByRole('button', { name: 'Stats', exact: true }).click();
    await expect(win.getByText('reddit.com', { exact: true })).toBeVisible();
    await expect(win.getByText('3 visits')).toBeVisible();
    if (process.env.STATS_SCREENSHOT_DIR) await win.screenshot({ path: `${process.env.STATS_SCREENSHOT_DIR}/stats-on.png`, fullPage: true });

    await win.getByRole('button', { name: 'Delete history' }).click();
    await win.getByRole('button', { name: 'Delete', exact: true }).click();
    await expect(win.getByText('Nothing blocked in the last 7 days.')).toBeVisible();

    await win.getByRole('button', { name: 'Turn off' }).click();
    await win.getByRole('button', { name: 'Turn off and delete' }).click();
    await expect(win.getByRole('button', { name: 'Turn on' })).toBeVisible();
  } finally {
    await app.close();
  }
});
