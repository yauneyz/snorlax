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
    args: [resolve(__dirname, '../../../apps/desktop/out/main/index.js')],
    env: { ...process.env, APP_ENV: 'development', TALYSMAN_PIPE: 'talysman-nonexistent' },
  });
  const win = await app.firstWindow();

  await win.getByText('Connecting…').waitFor({ state: 'detached' });
  await win.getByRole('button', { name: 'Turn on focus' }).click();
  await expect(win.getByText('FOCUSED')).toBeVisible();

  await win.getByRole('button', { name: 'Turn off focus' }).click();
  await expect(win.getByText('Insert your paired key')).toBeVisible();

  await app.close();
});
