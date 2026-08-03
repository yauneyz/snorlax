import { test, expect, _electron as electron } from '@playwright/test';
import { resolve } from 'node:path';

test('about shows client and service versions and exposes the updater check', async () => {
  const app = await electron.launch({
    args: [resolve(__dirname, '../../../apps/desktop/out/main/index.cjs')],
  });
  try {
    const win = await app.firstWindow();
    await win.getByText('Connecting…').waitFor({ state: 'detached' });

    const [info, stateResponse] = await win.evaluate(async () =>
      Promise.all([window.api.appInfo(), window.api.request('getState', undefined)]),
    );
    expect(info.usingMock).toBe(true);
    expect(stateResponse.ok).toBe(true);

    await win.getByRole('button', { name: 'Settings' }).click();
    await expect(win.getByText(`Client version: ${info.appVersion}`)).toBeVisible();
    await expect(
      win.getByText(
        `Service version: ${(stateResponse.result as { serviceVersion: string }).serviceVersion}`,
      ),
    ).toBeVisible();

    await win.getByRole('button', { name: 'Check for updates' }).click();
    await expect(win.getByRole('status')).toHaveText(
      'Update checks are only available in an installed app.',
    );
  } finally {
    await app.close();
  }
});
