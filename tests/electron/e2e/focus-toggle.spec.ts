/**
 * E2E scaffold: drives the real Electron app (against the in-process mock service) and
 * verifies the paired-key enable gate and the key-gated override that turns focus off. Requires @playwright/test +
 * playwright-electron to be installed (see README.md). Kept out of the vitest `pnpm test`
 * run so the unit suite stays dependency-light.
 */
import { test, expect } from '@playwright/test';
import { launchApp } from './launch.js';

test('focus requires a paired key and turning it off requires the key to be connected', async () => {
  const app = await launchApp();
  try {
    const win = await app.firstWindow();

    await win.getByText('Connecting…').waitFor({ state: 'detached' });

    // Never let this test mutate the installed privileged service. The E2E script compiles
    // a dedicated nonexistent pipe into the bundle; fail closed if that setup regresses.
    const info = await win.evaluate(() => window.api.appInfo());
    expect(info.usingMock).toBe(true);

    const enableButton = win.getByRole('button', { name: 'Turn on focus' });
    await expect(enableButton).toBeDisabled();
    await expect(win.getByText('pair a key to turn on focus')).toBeVisible();

    await win.getByRole('button', { name: 'Keys' }).click();
    await win.getByRole('button', { name: 'Pair this drive' }).click();
    await expect(win.getByRole('button', { name: 'unpair' })).toBeDisabled();
    await expect(win.getByText('Pair another key before removing your last key.')).toBeVisible();

    await win.getByRole('button', { name: 'Dashboard' }).click();
    await enableButton.click();
    await expect(win.getByText('FOCUSED')).toBeVisible();

    // Turning off is an override: without the key the service refuses and says why.
    await win.getByRole('button', { name: 'Turn off…' }).click();
    const dialog = win.getByRole('dialog', { name: 'Turn blocking off' });
    await expect(dialog.getByText('INSERT YOUR KEY')).toBeVisible();
    await dialog.getByRole('button', { name: /Turn everything off/ }).click();
    await expect(dialog.getByText(/Insert your key/)).toBeVisible();

    // With the (simulated) key it goes through, and "Re-enable all" brings it back.
    await win.evaluate(() => window.api.devToggleKey());
    await dialog.getByRole('button', { name: /Turn everything off/ }).click();
    await expect(win.getByText('UNPROTECTED')).toBeVisible();
    await win.getByRole('button', { name: 'Re-enable all' }).click();
    await expect(win.getByText('FOCUSED')).toBeVisible();
  } finally {
    await app.close();
  }
});
