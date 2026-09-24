/**
 * E2E: blocking profiles and the Free/Pro profile allowance. Drives the real Electron app
 * against the in-process mock service, the same way focus-toggle.spec.ts does.
 *
 * The walk starts by pinning Pro through the Settings switcher rather than trusting the default,
 * then drops to Free the same way.
 */
import { test, expect, type Page } from '@playwright/test';
import { launchApp } from './launch.js';

/** The Blocklists heading doubles as the profile switcher; it names the profile being edited. */
function switcher(win: Page) {
  return win.locator('button[aria-expanded]').filter({ hasText: 'to switch between' });
}

/** An open switcher menu sits above a dismiss layer that closes it when clicked. */
async function closeMenu(win: Page) {
  await win.locator('div.fixed.inset-0.z-40').click({ position: { x: 5, y: 5 } });
  await expect(switcher(win)).toHaveAttribute('aria-expanded', 'false');
}

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
    await expect(switcher(win)).toContainText('Default');
    await expect(win.getByText('ENFORCING NOW')).toBeVisible();

    // Pro can add profiles. The new one is selected for editing but does not take over
    // enforcement until it is explicitly activated.
    await switcher(win).click();
    await expect(win.getByText('SWITCH PROFILE · 1', { exact: true })).toBeVisible();
    await win.getByRole('button', { name: 'New profile' }).click();
    await expect(switcher(win)).toContainText('Profile 2');
    await expect(win.getByRole('button', { name: 'Activate now' })).toBeVisible();

    // Renaming writes through to the switcher.
    await switcher(win).click();
    const nameField = win.getByLabel('Profile name');
    await nameField.fill('Evening');
    await nameField.press('Enter');
    await expect(switcher(win)).toContainText('Evening');
    await closeMenu(win);

    // Activating it moves enforcement with it.
    await win.getByRole('button', { name: 'Activate now' }).click();
    await expect(win.getByText('ENFORCING NOW')).toBeVisible();

    // Drop to Free: the allowance shows up and "New profile" becomes an upgrade prompt.
    await win.getByRole('button', { name: 'Settings' }).click();
    await devPlan.getByText('Free').click();

    await win.getByRole('button', { name: 'Blocklists' }).click();
    await expect(switcher(win)).toContainText('Evening');
    await switcher(win).click();
    // Trimming to the Free allowance keeps whatever was being enforced, not merely the first.
    await expect(win.getByText('SWITCH PROFILE · 1/1', { exact: true })).toBeVisible();
    await expect(win.getByRole('button', { name: /^Default/ })).toBeHidden();

    await win.getByRole('button', { name: 'Upgrade for more profiles' }).click();
    await expect(win.getByRole('heading', { name: 'Pro' })).toBeVisible();
  } finally {
    await app.close();
  }
});
