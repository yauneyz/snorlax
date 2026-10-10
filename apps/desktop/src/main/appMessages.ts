/**
 * Messages we push to this app from the server (scripts/send-app-message.mjs) — the one way to
 * reach someone who never made an account. Fetched straight from the web API, never through the
 * daemon, and kicked off at the very top of bootstrap: the case this exists for is the daemon
 * being dead, where the app's only surface is the startup-failure dialog.
 *
 * Running app: a banner per message until dismissed, plus an OS notification the first time each
 * one arrives. Failed startup: appended to the error dialog.
 */

import { BrowserWindow, Notification, app } from 'electron';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { DEVICE_HEADERS, appMessageListSchema, type AppMessage } from '@talysman/product';
import { getAccessToken } from './auth/supabase.js';
import { config } from './config.js';
import { loadDeviceIdentity } from './deviceIdentity.js';
import { Channels } from './ipc/channels.js';
import { logger } from './logging.js';
import { showMainWindow } from './window.js';

const FETCH_TIMEOUT_MS = 5_000;
const POLL_INTERVAL_MS = 15 * 60_000;
/** Ids already announced with an OS notification, so a poll doesn't re-announce them. */
const SEEN_FILE = 'app-messages-seen.json';

let current: AppMessage[] = [];
let inFlight: Promise<AppMessage[]> | undefined;
let pollTimer: ReturnType<typeof setInterval> | undefined;

async function requestHeaders(): Promise<Record<string, string>> {
  const { identity } = await loadDeviceIdentity();
  // The token only adds account-targeted messages; failing to get one must not cost the device's.
  const token = await getAccessToken().catch(() => null);
  return {
    [DEVICE_HEADERS.id]: identity.deviceId,
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };
}

async function loadSeen(): Promise<Set<string>> {
  try {
    const raw = await readFile(join(app.getPath('userData'), SEEN_FILE), 'utf8');
    const ids = JSON.parse(raw) as unknown;
    return new Set(Array.isArray(ids) ? ids.filter((id): id is string => typeof id === 'string') : []);
  } catch {
    return new Set();
  }
}

async function saveSeen(seen: Set<string>): Promise<void> {
  try {
    await writeFile(join(app.getPath('userData'), SEEN_FILE), JSON.stringify([...seen]), 'utf8');
  } catch (error) {
    logger.warn('[messages] failed to persist seen ids', error);
  }
}

async function postReceipt(messageId: string, status: 'seen' | 'dismissed'): Promise<void> {
  try {
    await fetch(`${config.apiBaseUrl}/api/desktop/messages/receipt`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(await requestHeaders()) },
      body: JSON.stringify({ messageId, status }),
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
  } catch (error) {
    logger.warn(`[messages] failed to record ${status} receipt`, error);
  }
}

function broadcastChanged(): void {
  for (const win of BrowserWindow.getAllWindows()) {
    win.webContents.send(Channels.appEvent, { event: 'messagesChanged' });
  }
}

/** Announce messages this device hasn't seen before: receipt + (when asked) OS notification. */
async function announceNew(messages: AppMessage[], notify: boolean): Promise<void> {
  const seen = await loadSeen();
  const fresh = messages.filter((m) => !seen.has(m.id));
  if (fresh.length === 0) return;
  for (const message of fresh) {
    seen.add(message.id);
    void postReceipt(message.id, 'seen');
    if (notify && Notification.isSupported()) {
      const notification = new Notification({ title: message.title, body: message.body });
      notification.on('click', () => showMainWindow());
      notification.show();
    }
  }
  await saveSeen(seen);
}

async function fetchMessages(): Promise<AppMessage[]> {
  try {
    const res = await fetch(`${config.apiBaseUrl}/api/desktop/messages`, {
      headers: await requestHeaders(),
      cache: 'no-store',
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    if (!res.ok) throw new Error(`messages request failed: ${res.status}`);
    current = appMessageListSchema.parse(await res.json());
  } catch (error) {
    // Keep whatever we last had: a flaky network shouldn't make a banner vanish.
    logger.warn('[messages] fetch failed', error);
  }
  return current;
}

/** Fetch now, coalescing with a fetch already in flight. */
export function refreshAppMessages(): Promise<AppMessage[]> {
  inFlight ??= fetchMessages().finally(() => {
    inFlight = undefined;
  });
  return inFlight;
}

/** Called once the app is up: announce what's pending, then keep polling. */
export function initAppMessages(): void {
  const refresh = async () => {
    const messages = await refreshAppMessages();
    broadcastChanged();
    await announceNew(messages, true);
  };
  void refresh();
  pollTimer ??= setInterval(() => void refresh(), POLL_INTERVAL_MS);
}

export function getAppMessages(): AppMessage[] {
  return current;
}

export async function dismissAppMessage(id: string): Promise<void> {
  current = current.filter((m) => m.id !== id);
  broadcastChanged();
  await postReceipt(id, 'dismissed');
}

/**
 * Pending messages for the startup-failure dialog: their text, and the first link (dialogs can't
 * render one inline, so the caller turns it into a button). Waits on the fetch bootstrap already
 * started; the dialog itself is the announcement.
 */
export async function appMessagesForFailureDialog(): Promise<{
  text: string;
  link?: { url: string; label: string };
}> {
  const messages = await refreshAppMessages();
  if (messages.length === 0) return { text: '' };
  await announceNew(messages, false);
  const linked = messages.find((m) => m.linkUrl);
  return {
    text: messages.map((m) => `Message from Talysman: ${m.title}\n${m.body}`).join('\n\n'),
    ...(linked?.linkUrl ? { link: { url: linked.linkUrl, label: linked.linkLabel ?? 'Open link' } } : {}),
  };
}
