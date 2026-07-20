/**
 * E2E scaffold: drives the real Electron app (against the in-process mock service) and
 * verifies the focus toggle + key-required disable gate. Requires @playwright/test +
 * playwright-electron to be installed (see README.md). Kept out of the vitest `pnpm test`
 * run so the unit suite stays dependency-light.
 */
import { test, expect, _electron as electron } from '@playwright/test';
import { resolve } from 'node:path';

test('enable focus, then disabling without a key is blocked', async () => {
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

    await win.getByRole('button', { name: 'Turn on focus' }).click();
    await expect(win.getByText('FOCUSED')).toBeVisible();

    await win.getByRole('button', { name: 'Turn off focus' }).click();
    await expect(win.getByText('Insert your paired key')).toBeVisible();
  } finally {
    await app.close();
  }
});
