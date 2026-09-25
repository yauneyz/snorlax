/**
 * Renderer helpers around the engine protocol: run a command, explain a refusal the way the spec
 * words it (§5.5 — "Insert your key to save — this loosens an active profile and will reset your
 * N-day streak"), and small formatting helpers for engine times.
 */

import {
  ErrorCode,
  profileInput,
  type Command,
  type Gate,
  type Profile,
  type ProfileConfig,
  type ProfileStatus,
} from '@talysman/shared';
import { request, type BridgeError } from './bridge.js';
import { useFocusStore } from '../store/useFocusStore.js';

function bridgeError(code: string, message: string): BridgeError {
  const e = new Error(message) as BridgeError;
  e.code = code;
  return e;
}

/** What `command` needs right now (a dry run through the service). */
export async function gateOf(command: Command): Promise<Gate> {
  const result = await request('applyCommand', { command, dryRun: true });
  return result.gate ?? { kind: 'free' };
}

/** A human sentence for a gate that isn't free. */
export function gateMessage(gate: Gate, streakDays: number): string {
  switch (gate.kind) {
    case 'free':
      return '';
    case 'needsKey': {
      const what = gate.relaxations.length > 0 ? ` — ${gate.relaxations.join('; ').toLowerCase()}` : '';
      const streak = streakDays > 0 ? ` This resets your ${streakDays}-day streak.` : '';
      return `Insert your key to do this${what}.${streak}`;
    }
    case 'locked':
      return `A locked window holds this until ${formatClock(gate.untilMs)}. Only an emergency unlock gets past it.`;
    case 'denied':
      return gate.message;
  }
}

/**
 * Run a command. On KEY_REQUIRED / LOCKED the error message is rewritten from the engine's gate
 * so the user sees exactly what is being loosened.
 */
export async function runCommand(command: Command): Promise<void> {
  try {
    await request('applyCommand', { command });
  } catch (e) {
    const code = (e as BridgeError).code;
    if (code === ErrorCode.KEY_REQUIRED || code === ErrorCode.LOCKED) {
      const gate = await gateOf(command).catch(() => undefined);
      const streak = useFocusStore.getState().engine.streak.currentDays;
      if (gate && gate.kind !== 'free') throw bridgeError(code, gateMessage(gate, streak));
    }
    throw e;
  } finally {
    await useFocusStore.getState().refresh();
  }
}

/** Save a profile's name/colour/config (key-gated when it loosens a committed profile). */
export function saveProfile(profile: Pick<Profile, 'id' | 'name' | 'color'> & { config: ProfileConfig }): Promise<void> {
  return runCommand({ type: 'upsertProfile', profile: profileInput(profile) });
}

export function statusOf(profileId: string): ProfileStatus | undefined {
  return useFocusStore.getState().engine.profiles.find((p) => p.profile.id === profileId);
}

/** "9:30 AM" (today) or "Tue 9:30 AM" (another day). */
export function formatClock(ms: number, now = Date.now()): string {
  const date = new Date(ms);
  const time = date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  if (new Date(now).toDateString() === date.toDateString()) return time;
  return `${date.toLocaleDateString([], { weekday: 'short' })} ${time}`;
}

/** "12 min", "1 h 5 min", "45 s". */
export function formatDuration(ms: number): string {
  const total = Math.max(0, Math.round(ms / 1000));
  if (total < 60) return `${total} s`;
  const minutes = Math.round(total / 60);
  if (minutes < 60) return `${minutes} min`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m ? `${h} h ${m} min` : `${h} h`;
}

/** Why a profile is (or isn't) on, in a few words. */
export function activationLabel(status: ProfileStatus, now = Date.now()): string {
  const a = status.activation;
  if (a.paused) return 'paused';
  if (!a.active) return 'off';
  if (a.lockedUntilMs !== null) return `locked until ${formatClock(a.lockedUntilMs, now)}`;
  const window = a.windows[0];
  if (window) return `scheduled until ${formatClock(window.endMs, now)}`;
  return 'on';
}
