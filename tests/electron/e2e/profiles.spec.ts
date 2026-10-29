/**
 * E2E: blocking profiles and the Free/Pro profile allowance. Drives the real Electron app
 * against the in-process mock service, the same way focus-toggle.spec.ts does.
 *
 * The walk starts by pinning Pro through the Settings switcher rather than trusting the default,
 * then drops to Free the same way.
 */
import { test, expect, type Page } from '@playwright/test';
import { launchApp } from './launch.js';

/** The Blocklists page heading doubles as the mode switcher; it names the mode being edited. */
function switcher(win: Page) {
  return win.getByRole('button', { name: 'Choose mode', exact: true });
}

test('Pro gets unlimited blocking profiles that run side by side, Free gets one', async () => {
  const app = await launchApp();
  try {
    const win = await app.firstWindow();
    await win.getByText('Connecting…').waitFor({ state: 'detached' });

    const info = await win.evaluate(() => window.api.appInfo());
    expect(info.usingMock).toBe(true);

    const devPlan = win.getByRole('group', { name: 'Development account plan' });
    await win.getByRole('button', { name: 'Settings' }).click();
    await devPlan.getByText('Pro').click();

    // Turning a profile on needs a paired key.
    await win.getByRole('button', { name: 'Keys' }).click();
    await win.getByRole('button', { name: 'Pair this drive' }).click();

    await win.getByRole('button', { name: 'Blocklists' }).click();

    // One profile out of the box, switched off.
    await expect(switcher(win)).toContainText('Default');
    await expect(win.getByRole('switch', { name: 'Default off' })).toBeVisible();

    // Pro can add profiles; a new one starts off.
    await switcher(win).click();
    await expect(win.getByText('SWITCH MODE · 1', { exact: true })).toBeVisible();
    await win.getByRole('button', { name: 'New mode' }).click();
    await expect(switcher(win)).toContainText('Mode 2');

    // Renaming happens in place from the row's pencil and writes through to the switcher.
    await switcher(win).click();
    await win.getByRole('button', { name: 'Rename Mode 2', exact: true }).click();
    const nameField = win.getByLabel('Mode name');
    await nameField.fill('Evening');
    await nameField.press('Enter');
    await expect(switcher(win)).toContainText('Evening');
    // The row's trash icon asks before deleting.
    await win.getByRole('button', { name: 'Delete Evening', exact: true }).click();
    await expect(win.getByRole('dialog', { name: 'Delete mode?' })).toBeVisible();
    await win.getByRole('button', { name: 'Cancel', exact: true }).click();
    await expect(switcher(win)).toContainText('Evening');

    // Make it the mode "Turn on focus" uses.
    await switcher(win).click();
    await win.getByRole('button', { name: 'Make default' }).click();

    // Switching it on is free and leaves other profiles alone.
    await win.getByRole('switch', { name: 'Evening off' }).click();
    await expect(win.getByRole('switch', { name: 'Evening on' })).toBeVisible();

    // Drop to Free: the default profile is kept and the idle one is trimmed.
    await win.getByRole('button', { name: 'Settings' }).click();
    await devPlan.getByText('Free').click();

    await win.getByRole('button', { name: 'Blocklists' }).click();
    await expect(switcher(win)).toContainText('Evening');
    await switcher(win).click();
    await expect(win.getByText('SWITCH MODE · 1/1', { exact: true })).toBeVisible();
    await expect(win.getByRole('button', { name: /^Default/ })).toBeHidden();

    await win.getByRole('button', { name: 'Upgrade for more modes' }).click();
    await expect(win.getByRole('heading', { name: 'Pro' })).toBeVisible();
  } finally {
    await app.close();
  }
});
