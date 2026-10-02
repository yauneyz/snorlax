import { test, expect } from '@playwright/test';
import { launchApp } from './launch.js';

test('paste results and key rejections stay beside the list; mode confirmation keeps its label', async () => {
  const app = await launchApp();
  try {
    const win = await app.firstWindow();
    await win.getByText('Connecting…').waitFor({ state: 'detached' });
    expect((await win.evaluate(() => window.api.appInfo())).usingMock).toBe(true);

    await win.getByRole('button', { name: 'Settings' }).click();
    await win.getByRole('group', { name: 'Development account plan' }).getByText('Free').click();
    await win.getByRole('button', { name: 'Profiles', exact: true }).click();
    await win.getByRole('button', { name: /^Hard blocks/ }).click();

    const blocked = win
      .locator('div.min-w-0')
      .filter({
        has: win.getByText('Always block', { exact: true }),
      })
      .last();
    await blocked.getByRole('button', { name: 'Paste many' }).click();
    await blocked
      .locator('textarea')
      .fill('one.com\nONE.com\ntwo.com\nthree.com\nfour.com\nfive.com\nsix.com\nseven.com');
    await blocked.getByRole('button', { name: 'Add all' }).click();
    await expect(blocked.getByRole('status')).toHaveText(
      'Added 5 · 1 already listed or repeated · 2 over the Free limit',
    );
    await expect(blocked.getByText('Free limit reached', { exact: false })).toBeVisible();
    await expect(blocked.locator('input').first()).toBeDisabled();

    await expect(win.getByText('Always allow', { exact: true })).toBeHidden();
    await win.getByRole('radio', { name: 'Allow only these sites', exact: true }).click();
    await expect(win.getByText('Always block', { exact: true })).toBeHidden();

    // Adding an allowed site makes the internet mode require a separate confirmation.
    const allowed = win
      .locator('div.min-w-0')
      .filter({
        has: win.getByText('Always allow', { exact: true }),
      })
      .last();
    await allowed.locator('input').first().fill('mail.com');
    await allowed.getByRole('button', { name: 'Add', exact: true }).click();
    await expect(allowed.getByRole('button', { name: 'Remove mail.com' })).toBeVisible();
    const internetMode = win.getByRole('radio', { name: 'Block the internet', exact: true });
    await internetMode.click();
    await expect(internetMode).toHaveText('Block the internet');
    await expect(win.getByText('Block the internet and clear 1 allowed site?')).toBeVisible();
    await win.getByRole('button', { name: 'Cancel', exact: true }).click();
    await expect(allowed.getByRole('button', { name: 'Remove mail.com' })).toBeVisible();

    await win.getByRole('radio', { name: 'Block these sites', exact: true }).click();
    await expect(win.getByText('Always allow', { exact: true })).toBeHidden();
    await expect(win.getByText('Always block', { exact: true })).toBeVisible();

    // Activate with a paired key, then loosen without the key present.
    await win.getByRole('button', { name: 'Keys', exact: true }).click();
    await win.getByRole('button', { name: 'Pair this drive' }).click();
    await win.getByRole('button', { name: 'Profiles', exact: true }).click();
    await win.getByRole('switch', { name: 'Default off' }).click();
    await expect(win.getByRole('switch', { name: 'Default on' })).toBeVisible();
    const hardSection = win.getByRole('button', { name: /^Hard blocks/ });
    if ((await hardSection.getAttribute('aria-expanded')) !== 'true') await hardSection.click();
    await blocked.getByRole('button', { name: 'Remove one.com' }).click();
    await expect(blocked.getByRole('alert')).toContainText('Insert your key');
    await expect(blocked.getByRole('button', { name: 'Remove one.com' })).toBeVisible();
  } finally {
    await app.close();
  }
});
