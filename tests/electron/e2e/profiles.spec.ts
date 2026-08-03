/**
 * E2E: blocking profiles and the Free/Pro profile allowance. Drives the real Electron app
 * against the in-process mock service, the same way focus-toggle.spec.ts does.
 *
 * The walk starts by pinning Pro through the Settings switcher rather than trusting the default,
 * then drops to Free the same way.
 */
import { test, expect } from '@playwright/test';
import { launchApp } from './launch.js';

test('Pro gets unlimited blocking profiles, Free gets one', async () => {
  const app = await launchApp();
  try {
    const win = await app.firstWindow();
    await win.getByText('Connecting…').waitFor({ state: 'detached' });

    const info = await win.evaluate(() => window.api.appInfo());
    expect(info.usingMock).toBe(true);

    const devPlan = win.getByRole('group', { name: 'Development account plan' });
    await win.getByRole('button', { name: 'Settings' }).click();
    await devPlan.getByText('Pro').click();

    await win.getByRole('button', { name: 'Blocklists' }).click();

    // One profile out of the box, and it is the one focus enforces.
    await expect(win.getByRole('button', { name: /Default/ })).toBeVisible();
    await expect(win.getByText('enforced by focus')).toBeVisible();

    // Pro can add profiles. The new one is selected for editing but does not take over
    // enforcement until it is explicitly activated.
    await win.getByRole('button', { name: 'New profile' }).click();
    await expect(win.getByRole('button', { name: /Profile 2/ })).toBeVisible();
    await expect(win.getByRole('button', { name: 'Use this profile' })).toBeVisible();

    // Renaming writes through to the profile rail.
    const nameField = win.getByLabel('Profile name');
    await nameField.fill('Evening');
    await nameField.press('Enter');
    await expect(win.getByRole('button', { name: /Evening/ })).toBeVisible();

    // Activating it moves the "active" marker and the enforced policy with it.
    await win.getByRole('button', { name: 'Use this profile' }).click();
    await expect(win.getByText('enforced by focus')).toBeVisible();

    await win.getByRole('button', { name: 'Dashboard' }).click();
    await expect(win.getByText('Active profile')).toBeVisible();
    await expect(win.getByText('Evening', { exact: true })).toBeVisible();

    // Schedule windows are authored against a profile.
    await win.getByRole('button', { name: 'Schedule' }).click();
    await win.getByLabel('Blocking profile').selectOption({ label: 'Evening' });
    await win.getByRole('button', { name: 'Add window' }).click();
    await expect(win.getByText('mon, tue, wed, thu, fri - 09:00-17:00')).toBeVisible();

    // Drop to Free: the allowance shows up and the add button becomes an upgrade prompt.
    await win.getByRole('button', { name: 'Settings' }).click();
    await devPlan.getByText('Free').click();

    await win.getByRole('button', { name: 'Blocklists' }).click();
    await expect(win.getByText('1/1 profiles')).toBeVisible();
    await expect(win.getByRole('button', { name: 'Upgrade for more profiles' })).toBeVisible();

    // Trimming to the Free allowance keeps whatever was being enforced, not merely the first.
    await expect(win.getByRole('button', { name: /Evening/ })).toBeVisible();
    await expect(win.getByRole('button', { name: /Default/ })).toBeHidden();

    await win.getByRole('button', { name: 'Upgrade for more profiles' }).click();
    await expect(win.getByRole('heading', { name: 'Pro' })).toBeVisible();
  } finally {
    await app.close();
  }
});
