/**
 * E2E: the override sheet (pause with the key), the emergency unlock (no key, counts down from
 * five), the streak badge, and the app-blocked unlock popup window. Drives the real Electron app
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
    await win.getByRole('button', { name: 'Turn off…' }).click();
    const dialog = win.getByRole('dialog', { name: 'Turn blocking off' });
    await dialog.getByRole('button', { name: /Pause everything/ }).click();
    await dialog.getByRole('button', { name: '10 min' }).click();
    await dialog.getByRole('button', { name: 'Pause', exact: true }).click();
    await expect(win.getByText('PAUSED', { exact: true })).toBeVisible();
    await win.getByRole('button', { name: 'Re-enable all' }).click();
    await expect(win.getByText('FOCUSED')).toBeVisible();

    // Emergency: key removed, still possible, and it counts down.
    await win.evaluate(() => window.api.devToggleKey());
    await win.getByRole('button', { name: 'Turn off…' }).click();
    await dialog.getByRole('button', { name: /Emergency unlock — turns everything off \(5 left\)/ }).click();
    const confirm = win.getByRole('dialog', { name: 'Emergency unlock' });
    await confirm.getByRole('button', { name: 'Use emergency unlock' }).click();
    await expect(win.getByText('UNPROTECTED', { exact: true })).toBeVisible();
    await expect(win.getByText('4 left')).toBeVisible();
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
    await expect(popup.getByRole('button', { name: /Other options \(5 emergency unlocks left\)/ })).toBeVisible();
    const closed = popup.waitForEvent('close');
    await popup.getByRole('button', { name: 'Not now' }).click();
    await closed;
  } finally {
    await app.close();
  }
});
