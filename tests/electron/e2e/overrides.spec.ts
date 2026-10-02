/**
 * E2E: pausing with the key, the emergency unlock in Settings (no key, counts down from five), the streak badge, and the app-blocked unlock popup window. Drives the real Electron app
 * against the in-process mock service, whose decisions come from the Rust engine (wasm).
 */
import { test, expect } from '@playwright/test';
import { launchApp } from './launch.js';

test('pausing needs the key, an emergency unlock does not', async () => {
  const app = await launchApp();
  try {
    const win = await app.firstWindow();
    await win.getByText('Connecting…').waitFor({ state: 'detached' });
    expect((await win.evaluate(() => window.api.appInfo())).usingMock).toBe(true);

    await win.getByRole('button', { name: 'Keys' }).click();
    await win.getByRole('button', { name: 'Pair this drive' }).click();
    await win.getByRole('button', { name: 'Dashboard' }).click();
    await win.getByRole('button', { name: 'Turn on focus' }).click();
    await expect(win.getByText('FOCUSED')).toBeVisible();
    await expect(win.getByText('0-day streak')).toBeVisible();

    // Pause for 10 minutes with the key.
    await win.evaluate(() => window.api.devToggleKey());
    await win.getByRole('button', { name: 'Pause until…' }).click();
    const dialog = win.getByRole('dialog', { name: 'Pause until…' });
    await dialog.getByRole('button', { name: '10 min' }).click();
    await dialog.getByRole('button', { name: 'Pause', exact: true }).click();
    await expect(win.getByText('PAUSED', { exact: true })).toBeVisible();
    await win.getByRole('button', { name: 'Turn on focus' }).click();
    await expect(win.getByText('FOCUSED')).toBeVisible();

    // Emergency: key removed, still possible, and it counts down.
    await win.evaluate(() => window.api.devToggleKey());
    await expect(win.getByRole('button', { name: 'Temporary unlock' })).toBeVisible();
    await win.getByRole('button', { name: 'Settings' }).click();
    await win.getByRole('button', { name: 'Use emergency unlock…' }).click();
    const confirm = win.getByRole('dialog', { name: 'Emergency unlock' });
    await confirm.getByRole('button', { name: 'Use emergency unlock' }).click();
    await win.getByRole('button', { name: 'Dashboard' }).click();
    await expect(win.getByText('UNPROTECTED', { exact: true })).toBeVisible();
    await win.getByRole('button', { name: 'Settings' }).click();
    await expect(win.getByText('4', { exact: true })).toBeVisible();
  } finally {
    await app.close();
  }
});

test('a blocked app opens the unlock popup', async () => {
  const app = await launchApp();
  try {
    const win = await app.firstWindow();
    await win.getByText('Connecting…').waitFor({ state: 'detached' });
    const popupPromise = app.waitForEvent('window');
    await win.evaluate(() => window.api.devSimulateAppBlocked({ label: 'Game', linuxProcessName: 'game' }));
    const popup = await popupPromise;
    await expect(popup.getByText('Game')).toBeVisible();
    await expect(popup.getByText(/streak/)).toBeVisible();
    await expect(popup.getByRole('button', { name: 'Other options' })).toBeVisible();
    const closed = popup.waitForEvent('close');
    await popup.getByRole('button', { name: 'Not now' }).click();
    await closed;
  } finally {
    await app.close();
  }
});

test('temporary unlock can be kept or ended early from the dashboard', async () => {
  const app = await launchApp();
  try {
    const win = await app.firstWindow();
    await win.getByText('Connecting…').waitFor({ state: 'detached' });
    expect((await win.evaluate(() => window.api.appInfo())).usingMock).toBe(true);

    await win.getByRole('button', { name: 'Keys', exact: true }).click();
    await win.getByRole('button', { name: 'Pair this drive' }).click();
    await win.getByRole('button', { name: 'Profiles', exact: true }).click();
    await win.getByRole('button', { name: /^Unlock groups/ }).click();
    await win.getByRole('button', { name: '+ New group', exact: true }).click();
    await win.getByRole('button', { name: 'youtube.com', exact: true }).click();
    await win.getByRole('button', { name: 'Dashboard', exact: true }).click();
    await win.getByRole('button', { name: 'Turn on focus' }).click();
    await win.getByRole('button', { name: 'Temporary unlock', exact: true }).click();
    await win.getByRole('button', { name: 'Unlock for 10 min', exact: true }).click();
    await expect(win.getByText(/Temporary unlock · Group 1/)).toBeVisible();
    await expect(win.getByRole('button', { name: 'Re-enable all' })).toBeHidden();

    await win.getByRole('button', { name: 'End unlock early' }).click();
    const confirm = win.getByRole('dialog', { name: 'End temporary unlock early?' });
    await confirm.getByRole('button', { name: 'Cancel', exact: true }).click();
    await expect(win.getByText(/Temporary unlock · Group 1/)).toBeVisible();
    await win.getByRole('button', { name: 'End unlock early' }).click();
    await confirm.getByRole('button', { name: 'End unlock now' }).click();
    await expect(confirm).toBeHidden();
    await expect(win.getByText(/Temporary unlock · Group 1/)).toBeHidden();
    await expect(win.getByText('FOCUSED', { exact: true })).toBeVisible();
  } finally {
    await app.close();
  }
});
