/**
 * E2E scaffold: drives the real Electron app (against the in-process mock service) and
 * verifies the paired-key enable gate + key-presence disable gate. Requires @playwright/test +
 * playwright-electron to be installed (see README.md). Kept out of the vitest `pnpm test`
 * run so the unit suite stays dependency-light.
 */
import { test, expect, _electron as electron } from '@playwright/test';
import { resolve } from 'node:path';

test('focus requires a paired key and disabling requires it to be connected', async () => {
  const app = await electron.launch({
    args: [resolve(__dirname, '../../../apps/desktop/out/main/index.cjs')],
  });
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

    await expect(win.getByRole('button', { name: 'Turn off focus' })).toBeDisabled();
    await expect(win.getByText('insert key to turn off focus')).toBeVisible();
  } finally {
    await app.close();
  }
});
