/**
 * Desktop-side analytics (architecture §7-8/Phases 6-7): device identity and best-effort
 * delivery of milestone + usage events (always on) to the web ingest API
 * (`apps/web/src/server/analytics`). Mirrors `onboarding.ts`'s persistence idiom throughout —
 * `app.getPath('userData')`, `mode: 0o600`, an in-memory cache, and a try/catch that degrades
 * to a safe default and never throws. Losing any file here is safe: it only means missing
 * analytics data, never broken enforcement.
 *
 * Two usage sources coexist: Phase 6's *observed* accumulator (app opens + paired
 * focusChanged timestamps, always running) and Phase 7's *exact* rollup via the service's
 * `drainUsage` RPC (rollupUsage from @talysman/core). `flushUsage()` prefers the exact source
 * once a session confirms the connected service supports it, and falls back to observed
 * counts against an old service that answers BAD_REQUEST — cached per session, never
 * re-probed every cycle.
 */

import { randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import { join } from 'node:path';
import { app } from 'electron';
import { rollupUsage } from '@talysman/core';
import type { UsageTransition } from '@talysman/shared';
import { config } from './config.js';
import { logger } from './logging.js';
import { getAccessToken } from './auth/supabase.js';
import { isServiceError, type ServiceConnection } from './service/connection.js';

const DEVICE_ID_FILE = 'device-id.json';
const TELEMETRY_FILE = 'telemetry.json';
const QUEUE_FILE = 'analytics-queue.ndjson';
const USAGE_FILE = 'usage-daily.json';

export const MAX_QUEUE_EVENTS = 5000;
export const MAX_QUEUE_BYTES = 2 * 1024 * 1024;

const FLUSH_INTERVAL_MS = 15 * 60_000;
const FLUSH_BATCH_LIMIT = 100;
const FLUSH_TIMEOUT_MS = 5000;
const QUIT_FLUSH_TIMEOUT_MS = 2000;
const FOCUS_SESSION_LIFETIME_CAP = 3;

interface DeviceIdentity {
  deviceId: string;
  installedAt: string;
}

interface TelemetryState {
  lastExtensionConnectedDate?: string;
  /** Set only once the server has *accepted* app_installed — see trackAppInstalledOnce. */
  appInstalledReported?: boolean;
  focusSessionsTracked?: number;
  drainUsageSupported?: boolean;
  lastUsageSeq?: number;
}

interface UsageDay {
  app_opens: number;
  focus_seconds: number;
}

/**
 * Event names this client emits. Kept in sync by hand with the server's zod allowlist at
 * apps/web/src/lib/analytics/events.ts — desktop has no visibility into the web app's source.
 */
export type DesktopAnalyticsEvent =
  | 'app_installed'
  | 'service_install_started'
  | 'service_installed'
  | 'service_install_failed'
  | 'onboarding_completed'
  | 'usb_key_paired'
  | 'usb_pair_failed'
  | 'schedule_created'
  | 'extension_connected'
  | 'focus_session_completed'
  | 'bootstrap_failed'
  | 'window_load_failed'
  | 'main_process_error'
  | 'renderer_error'
  | 'service_disconnected'
  | 'ipc_handler_error';

let deviceCache: DeviceIdentity | undefined;
let telemetryCache: TelemetryState | undefined;
let queueCache: string[] | undefined;
let usageCache: Record<string, UsageDay> | undefined;

/** Serializes reads/writes against the on-disk files above so concurrent track() calls don't race. */
let writeChain: Promise<unknown> = Promise.resolve();
function chain<T>(fn: () => Promise<T>): Promise<T> {
  const result = writeChain.then(fn, fn);
  writeChain = result.catch(() => undefined);
  return result;
}

async function pathFor(file: string): Promise<string> {
  const dir = app.getPath('userData');
  await mkdir(dir, { recursive: true });
  return join(dir, file);
}

/**
 * The ingest API's platform enum is `win | mac | linux` (apps/web/src/lib/analytics/events.ts),
 * not Node's `process.platform`. Sending `win32`/`darwin` fails zod validation, and the server
 * answers 400 — which `postTrackEvent` treats as permanent and drops. Map here, once.
 */
function analyticsPlatform(): 'win' | 'mac' | 'linux' {
  if (process.platform === 'win32') return 'win';
  if (process.platform === 'darwin') return 'mac';
  return 'linux';
}

function localDateString(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

// ---------------------------------------------------------------------------
// device identity — the file's absence means a fresh install (a new device_id is minted)
// ---------------------------------------------------------------------------

async function loadDeviceIdentity(): Promise<{ identity: DeviceIdentity }> {
  if (deviceCache) return { identity: deviceCache };

  try {
    const parsed = JSON.parse(await readFile(await pathFor(DEVICE_ID_FILE), 'utf8')) as Partial<DeviceIdentity>;
    if (typeof parsed.deviceId === 'string') {
      deviceCache = {
        deviceId: parsed.deviceId,
        installedAt: typeof parsed.installedAt === 'string' ? parsed.installedAt : new Date().toISOString(),
      };
      return { identity: deviceCache };
    }
  } catch {
    // Missing or unreadable: this is a first run.
  }

  const identity: DeviceIdentity = { deviceId: randomUUID(), installedAt: new Date().toISOString() };
  try {
    await writeFile(await pathFor(DEVICE_ID_FILE), JSON.stringify(identity), { mode: 0o600 });
  } catch (error) {
    logger.warn('[analytics] could not persist device id', error);
  }
  deviceCache = identity;
  return { identity };
}

// ---------------------------------------------------------------------------
// telemetry state (always on — counts/durations only, never domains, app names, or content)
// ---------------------------------------------------------------------------

async function loadTelemetry(): Promise<TelemetryState> {
  if (telemetryCache) return telemetryCache;
  try {
    const parsed = JSON.parse(await readFile(await pathFor(TELEMETRY_FILE), 'utf8')) as Partial<TelemetryState>;
    telemetryCache = {
      lastExtensionConnectedDate: parsed.lastExtensionConnectedDate,
      appInstalledReported: parsed.appInstalledReported ?? false,
      focusSessionsTracked: parsed.focusSessionsTracked ?? 0,
      lastUsageSeq: parsed.lastUsageSeq ?? 0,
      // drainUsageSupported is intentionally not restored from disk — cached per session only.
    };
  } catch {
    telemetryCache = { focusSessionsTracked: 0, lastUsageSeq: 0 };
  }
  return telemetryCache;
}

async function saveTelemetry(state: TelemetryState): Promise<void> {
  telemetryCache = state;
  try {
    const { drainUsageSupported: _sessionOnly, ...persisted } = state;
    await writeFile(await pathFor(TELEMETRY_FILE), JSON.stringify(persisted), { mode: 0o600 });
  } catch (error) {
    logger.warn('[analytics] could not persist telemetry state', error);
  }
}

// ---------------------------------------------------------------------------
// offline queue for tier-1 milestone events — pure cap logic, unit-tested directly
// ---------------------------------------------------------------------------

function queueByteLength(lines: string[]): number {
  return lines.reduce((total, line) => total + Buffer.byteLength(line, 'utf8') + 1, 0);
}

/** Append one NDJSON line, dropping the oldest entries past either cap. Pure — no I/O. */
export function appendCapped(lines: string[], newLine: string): string[] {
  let next = lines.length >= MAX_QUEUE_EVENTS ? lines.slice(lines.length - MAX_QUEUE_EVENTS + 1) : lines;
  next = [...next, newLine];
  while (queueByteLength(next) > MAX_QUEUE_BYTES && next.length > 1) {
    next = next.slice(1);
  }
  return next;
}

async function loadQueue(): Promise<string[]> {
  if (queueCache) return queueCache;
  try {
    const raw = await readFile(await pathFor(QUEUE_FILE), 'utf8');
    queueCache = raw.split('\n').filter(Boolean);
  } catch {
    queueCache = [];
  }
  return queueCache;
}

async function saveQueue(lines: string[]): Promise<void> {
  queueCache = lines;
  try {
    await writeFile(await pathFor(QUEUE_FILE), lines.length ? lines.join('\n') + '\n' : '', { mode: 0o600 });
  } catch (error) {
    logger.warn('[analytics] could not persist analytics queue', error);
  }
}

/**
 * Queue a milestone event for delivery. Fire-and-forget from the caller's perspective — never
 * throws.
 */
export function track(
  event: DesktopAnalyticsEvent,
  props?: Record<string, unknown>,
  occurredAt?: string,
): void {
  void chain(async () => {
    const { identity } = await loadDeviceIdentity();
    const line = JSON.stringify({
      event,
      source: 'desktop',
      device_id: identity.deviceId,
      occurred_at: occurredAt ?? new Date().toISOString(),
      app_version: app.getVersion(),
      platform: analyticsPlatform(),
      props: props ?? {},
    });
    const queue = await loadQueue();
    await saveQueue(appendCapped(queue, line));
  });
}

// ---------------------------------------------------------------------------
// flush — one event per request (the ingest route takes no batch form for tier 1)
// ---------------------------------------------------------------------------

async function postTrackEvent(line: string): Promise<'sent' | 'retry' | 'drop'> {
  try {
    const token = await getAccessToken();
    const res = await fetch(`${config.apiBaseUrl}/api/analytics/track`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: line,
      signal: AbortSignal.timeout(FLUSH_TIMEOUT_MS),
    });
    if (res.ok) return 'sent';
    if (res.status >= 500) return 'retry';
    logger.warn(`[analytics] event rejected (HTTP ${res.status}), dropping`, line);
    return 'drop';
  } catch (error) {
    logger.warn('[analytics] flush request failed', error);
    return 'retry';
  }
}

export async function flushEvents(): Promise<void> {
  await chain(async () => {
    let queue = await loadQueue();
    let processed = 0;
    while (queue.length > 0 && processed < FLUSH_BATCH_LIMIT) {
      const line = queue[0]!;
      const outcome = await postTrackEvent(line);
      if (outcome === 'retry') break;
      if (outcome === 'sent' && line.includes('"app_installed"')) {
        await saveTelemetry({ ...(await loadTelemetry()), appInstalledReported: true });
      }
      queue = queue.slice(1);
      processed += 1;
    }
    await saveQueue(queue);
  });
}

// ---------------------------------------------------------------------------
// usage — Phase 6 observed accumulator, superseded per-flush by Phase 7's exact drain
// ---------------------------------------------------------------------------

async function loadUsage(): Promise<Record<string, UsageDay>> {
  if (usageCache) return usageCache;
  try {
    usageCache = JSON.parse(await readFile(await pathFor(USAGE_FILE), 'utf8')) as Record<string, UsageDay>;
  } catch {
    usageCache = {};
  }
  return usageCache;
}

async function saveUsage(data: Record<string, UsageDay>): Promise<void> {
  usageCache = data;
  try {
    await writeFile(await pathFor(USAGE_FILE), JSON.stringify(data), { mode: 0o600 });
  } catch (error) {
    logger.warn('[analytics] could not persist usage accumulator', error);
  }
}

/** Bump today's observed app-open counter. Superseded by Phase 7 for focus time, not opens. */
export function recordAppOpen(): void {
  void chain(async () => {
    const usage = await loadUsage();
    const day = localDateString(new Date());
    const entry = usage[day] ?? { app_opens: 0, focus_seconds: 0 };
    usage[day] = { ...entry, app_opens: entry.app_opens + 1 };
    await saveUsage(usage);
  });
}

function recordObservedFocusSeconds(seconds: number): void {
  if (seconds <= 0) return;
  void chain(async () => {
    const usage = await loadUsage();
    const day = localDateString(new Date());
    const entry = usage[day] ?? { app_opens: 0, focus_seconds: 0 };
    usage[day] = { ...entry, focus_seconds: entry.focus_seconds + Math.round(seconds) };
    await saveUsage(usage);
  });
}

async function flushUsageObserved(deviceId: string): Promise<void> {
  const usage = await loadUsage();
  const days = Object.keys(usage);
  if (days.length === 0) return;

  const today = localDateString(new Date());
  const tzOffsetMinutes = -new Date().getTimezoneOffset();
  const rows = days.slice(0, 40).map((local_date) => ({
    local_date,
    tz_offset_minutes: tzOffsetMinutes,
    platform: analyticsPlatform(),
    app_opens: usage[local_date]!.app_opens,
    focus_seconds: usage[local_date]!.focus_seconds,
  }));

  const sent = await postUsageRows(deviceId, rows);
  if (!sent) return;
  // Days other than today are closed out; today keeps accumulating toward the next flush.
  const remaining = today in usage ? { [today]: usage[today]! } : {};
  await saveUsage(remaining);
}

async function flushUsageExact(service: ServiceConnection, deviceId: string): Promise<void> {
  const telemetry = await loadTelemetry();
  const afterSeq = telemetry.lastUsageSeq ?? 0;

  let transitions: UsageTransition[];
  let latestSeq: number;
  try {
    const result = await service.request('drainUsage', { afterSeq });
    transitions = result.transitions;
    latestSeq = result.latestSeq;
  } catch (error) {
    if (isServiceError(error) && error.code === 'BAD_REQUEST') {
      await saveTelemetry({ ...telemetry, drainUsageSupported: false });
      return flushUsageObserved(deviceId);
    }
    return; // transient — retry next cycle
  }
  await saveTelemetry({ ...telemetry, drainUsageSupported: true });

  if (transitions.length === 0 && latestSeq === afterSeq) return;

  const tzOffsetMinutes = -new Date().getTimezoneOffset();
  const today = localDateString(new Date());
  // The service's transition log has no notion of the UI being opened, so app_opens (and with
  // it the dashboard's UI-DAU) can only come from the observed accumulator. Fold it into the
  // exact rows rather than letting it rot in usage-daily.json.
  const observed = await loadUsage();
  const rows = rollupUsage(
    transitions,
    observed[today]?.app_opens ?? 0,
    tzOffsetMinutes,
    new Date(),
    analyticsPlatform(),
    app.getVersion(),
  ).map((row) => ({
    ...row,
    app_opens: row.app_opens || (observed[row.local_date]?.app_opens ?? 0),
  }));
  // Days the UI was opened but focus never toggled produce no transition rows at all.
  for (const [local_date, entry] of Object.entries(observed)) {
    if (entry.app_opens === 0 || rows.some((row) => row.local_date === local_date)) continue;
    rows.push({
      local_date,
      tz_offset_minutes: tzOffsetMinutes,
      platform: analyticsPlatform(),
      app_version: app.getVersion(),
      focus_seconds: 0,
      key_present_seconds: 0,
      app_opens: entry.app_opens,
    });
  }
  const sent = await postUsageRows(deviceId, rows);
  if (!sent) return;
  // Reported days are closed out; today keeps accumulating toward the next flush.
  await saveUsage(today in observed ? { [today]: { ...observed[today]!, app_opens: 0 } } : {});
  await chain(async () => {
    const current = await loadTelemetry();
    await saveTelemetry({ ...current, lastUsageSeq: latestSeq });
  });
}

async function postUsageRows(deviceId: string, rows: readonly unknown[]): Promise<boolean> {
  if (rows.length === 0) return true;
  try {
    const res = await fetch(`${config.apiBaseUrl}/api/analytics/usage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ device_id: deviceId, rows }),
      signal: AbortSignal.timeout(FLUSH_TIMEOUT_MS),
    });
    return res.ok;
  } catch {
    return false;
  }
}

async function flushUsage(service: ServiceConnection | undefined): Promise<void> {
  const { identity } = await loadDeviceIdentity();
  const telemetry = await loadTelemetry();

  if (service && telemetry.drainUsageSupported !== false) {
    await flushUsageExact(service, identity.deviceId);
  } else {
    await flushUsageObserved(identity.deviceId);
  }
}

export async function flushNow(service?: ServiceConnection): Promise<void> {
  await flushEvents();
  await flushUsage(service);
}

// ---------------------------------------------------------------------------
// milestone subscriptions + lifecycle
// ---------------------------------------------------------------------------

let flushTimer: ReturnType<typeof setInterval> | undefined;
let boundService: ServiceConnection | undefined;

/** Called once from bootstrap(), after connectService(). Starts the flush loop and subscribes
 * to the service events that drive extension_connected / focus_session_completed / app_opens. */
export function initAnalytics(service: ServiceConnection): void {
  boundService = service;
  void flushNow(service);
  flushTimer = setInterval(() => void flushNow(boundService), FLUSH_INTERVAL_MS);

  service.on('extensionHeartbeat', () => {
    void chain(async () => {
      const telemetry = await loadTelemetry();
      const today = localDateString(new Date());
      if (telemetry.lastExtensionConnectedDate === today) return;
      await saveTelemetry({ ...telemetry, lastExtensionConnectedDate: today });
      track('extension_connected');
    });
  });

  let focusStartedAt: number | undefined;
  service.on('focusChanged', ({ active }) => {
    if (active) {
      focusStartedAt = Date.now();
      return;
    }
    if (focusStartedAt === undefined) return;
    const durationMs = Date.now() - focusStartedAt;
    focusStartedAt = undefined;
    recordObservedFocusSeconds(durationMs / 1000);

    void chain(async () => {
      const telemetry = await loadTelemetry();
      const count = telemetry.focusSessionsTracked ?? 0;
      if (count >= FOCUS_SESSION_LIFETIME_CAP) return;
      await saveTelemetry({ ...telemetry, focusSessionsTracked: count + 1 });
      track('focus_session_completed', {
        duration_s: Math.round(durationMs / 1000),
        session_index: count + 1,
      });
    });
  });
}

export function stopAnalytics(): void {
  if (flushTimer) clearInterval(flushTimer);
  flushTimer = undefined;
}

/**
 * Called first in bootstrap(). Emits `app_installed` until the server has actually accepted it,
 * not just once on first run: a rejected event is dropped by `postTrackEvent`, and gating on the
 * absence of device-id.json meant one bad request lost the install forever (which is exactly what
 * the `win32` platform bug did to every Windows and macOS install). Re-sending is safe — the
 * server derives `app_installed:<device_id>` as an idempotency key and dedupes
 * (ONCE_PER_PERSON_EVENTS in apps/web/src/lib/analytics/events.ts).
 */
export async function trackAppInstalledOnce(): Promise<void> {
  const { identity } = await loadDeviceIdentity();
  const telemetry = await loadTelemetry();
  if (telemetry.appInstalledReported) return;
  // installedAt, not now(): on a device that predates this retry the real install date is the
  // honest timestamp, and the desktop clock skew window is 35 days wide for exactly this reason.
  track(
    'app_installed',
    {
      platform: analyticsPlatform(),
      app_version: app.getVersion(),
      os_version: os.release(),
    },
    identity.installedAt,
  );
}

/** Best-effort flush on quit, bounded so shutdown is never blocked on the network. */
export async function shutdownFlush(): Promise<void> {
  await Promise.race([
    flushNow(boundService),
    new Promise((resolve) => setTimeout(resolve, QUIT_FLUSH_TIMEOUT_MS)),
  ]);
}
