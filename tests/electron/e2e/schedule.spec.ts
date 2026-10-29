/**
 * E2E: a new recurring block is a draft until saved, so it can't switch a mode on (and lock it)
 * before its time and days are set.
 */
import { test, expect } from '@playwright/test';
import { launchApp } from './launch.js';

test('a new block stays unsaved until confirmed', async () => {
  const app = await launchApp();
  try {
    const win = await app.firstWindow();
    await win.getByText('Connecting…').waitFor({ state: 'detached' });

    await win.getByRole('button', { name: 'Settings' }).click();
    await win.getByRole('group', { name: 'Development account plan' }).getByText('Pro').click();
    await win.getByRole('button', { name: 'Schedule' }).click();
    await expect(win.getByText('No blocks yet')).toBeVisible();

    // Cancelling a draft leaves nothing behind.
    await win.getByRole('button', { name: '+ New block' }).click();
    await expect(win.getByText('NOT SAVED', { exact: true })).toBeVisible();
    await expect(win.getByText('Recurring blocks · 0')).toBeVisible();
    await win.getByRole('button', { name: 'Cancel', exact: true }).click();
    await expect(win.getByText('No blocks yet')).toBeVisible();

    // Saving is what adds it.
    await win.getByRole('button', { name: '+ New block' }).click();
    await win.getByRole('button', { name: 'Save block' }).click();
    await expect(win.getByText('NOT SAVED', { exact: true })).toBeHidden();
    await expect(win.getByText('Recurring blocks · 1')).toBeVisible();
  } finally {
    await app.close();
  }
});
