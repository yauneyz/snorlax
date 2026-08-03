/**
 * E2E: the first-run walkthrough. Launches with an unseeded `userData` so the walkthrough shows,
 * then walks it end to end — including the browser-extension step, whose "connected" state is
 * driven by a real `extensionHeartbeat` event from the mock service rather than by UI state.
 */
import { test, expect } from '@playwright/test';
import { launchApp } from './launch.js';

test('the walkthrough runs on first launch and confirms extension contact', async () => {
  const app = await launchApp({ firstRun: true });
  try {
    const win = await app.firstWindow();

    await expect(win.getByRole('heading', { name: 'The shield stays up.' })).toBeVisible();
    await win.getByRole('button', { name: 'Set it up' }).click();

    // Step 2 — mode.
    await expect(win.getByRole('heading', { name: 'How much do you want blocked?' })).toBeVisible();
    await win.getByRole('button', { name: /^Block all/ }).click();
    await win.getByRole('button', { name: 'Continue' }).click();

    // Step 3 — extension. Nothing has beaten yet, so the channel reads as no contact and the
    // primary action offers to move on without it.
    await expect(win.getByRole('heading', { name: 'Add the browser extension' })).toBeVisible();
    await expect(win.getByText('NO CONTACT')).toBeVisible();
    await expect(win.getByRole('button', { name: 'Do this later' })).toBeVisible();

    // A heartbeat through the real RPC path is what flips it.
    const beat = await win.evaluate(() =>
      window.api.request('extHeartbeat', {
        browserPid: 4242,
        browser: 'Chrome',
        extensionVersion: '9.9.9',
        health: { canBlock: true, permissionsOk: true },
      }),
    );
    expect(beat.ok).toBe(true);

    await expect(win.getByText('HANDSHAKE OK')).toBeVisible();
    await expect(win.getByText(/Chrome extension connected · v9\.9\.9/)).toBeVisible();
    await win.getByRole('button', { name: 'Continue' }).click();

    // Step 4 — key. The mock always offers two drives; pair the selected one.
    await expect(win.getByRole('heading', { name: 'Pair a USB drive' })).toBeVisible();
    await win.getByPlaceholder('Label · e.g. Desk key').fill('Desk key');
    await win.getByRole('button', { name: 'Pair this drive' }).click();

    // Step 5 — summary. Block-all plus a paired key is enough to raise the shield.
    await expect(win.getByRole('heading', { name: /Block all · Desk key/ })).toBeVisible();
    await win.getByRole('button', { name: 'Raise shield' }).click();

    // The walkthrough is gone, the app is behind it, and focus is actually on.
    await expect(win.getByRole('button', { name: 'Skip setup' })).toHaveCount(0);
    await expect(win.getByRole('button', { name: 'Dashboard' })).toBeVisible();

    const state = await win.evaluate(() => window.api.request('getState', undefined));
    expect((state.result as { focusActive: boolean }).focusActive).toBe(true);
    expect(await win.evaluate(() => window.api.onboardingStatus())).toMatchObject({
      complete: true,
    });
  } finally {
    await app.close();
  }
});
