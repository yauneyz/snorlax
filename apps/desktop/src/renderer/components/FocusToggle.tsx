/**
 * The seal — the app's one big control. "Turn on focus" latches the default profile on (free,
 * needs a paired key); "Turn off…" opens the override sheet (key-gated, breaks the streak);
 * "Re-enable all" undoes any override. The pill under the seal opens the profile list, where
 * any number of profiles can be switched on. The service re-checks every gate itself.
 */
import React, { useState } from 'react';
import { ErrorCode } from '@talysman/shared';
import { useFocusStore } from '../store/useFocusStore.js';
import { formatClock, runCommand } from '../lib/engine.js';
import { cx, profileSummary } from '../lib/utils.js';
import { Button, ProfileDot } from './ui/index.js';
import { TalysmanMark } from './TalysmanMark.js';
import { ProfileList } from './ProfileList.js';
import { StreakBadge } from './StreakBadge.js';

const RING = 272;

export function FocusToggle() {
  const focusActive = useFocusStore((s) => s.focusActive);
  const pairedKeys = useFocusStore((s) => s.pairedKeys);
  const engine = useFocusStore((s) => s.engine);
  const defaultProfileId = useFocusStore((s) => s.defaultProfileId);
  const aiMode = useFocusStore((s) => s.aiMode);
  const setOverridesOpen = useFocusStore((s) => s.setOverridesOpen);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [listOpen, setListOpen] = useState(false);

  const active = engine.profiles.filter((p) => p.activation.active);
  const pairedKeyRequired = !focusActive && pairedKeys.length === 0;
  const lockedUntil = Math.max(0, ...active.map((p) => p.activation.lockedUntilMs ?? 0));
  const pausedUntil = engine.overrides.timed?.untilMs;
  const only = active.length === 1 ? active[0]!.profile : undefined;

  async function turnOn() {
    setBusy(true);
    setMessage(null);
    try {
      await runCommand({ type: 'setLatch', profileId: defaultProfileId, on: true });
    } catch (e) {
      const code = (e as { code?: string }).code;
      setMessage(code === ErrorCode.NO_PAIRED_KEY ? 'Pair a key before turning on focus.' : (e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function reenable() {
    setBusy(true);
    setMessage(null);
    try {
      await runCommand({ type: 'reenableAll' });
    } catch (e) {
      setMessage((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col items-center">
      <div className="relative flex items-center justify-center" style={{ width: RING, height: RING }}>
        <div
          data-focus-glow
          className={cx(
            'absolute inset-0 rounded-full border',
            focusActive
              ? 'border-ok/40 shadow-[0_0_42px_rgb(var(--color-success)/0.14),inset_0_0_44px_rgb(var(--color-success)/0.06)]'
              : 'border-white/[0.10] shadow-[inset_0_1px_0_rgb(var(--color-white)/0.08)]',
          )}
        />
        <div className="absolute inset-4 rounded-full border border-dashed border-white/[0.06]" />
        <div className="relative flex flex-col items-center gap-1.5">
          <TalysmanMark
            data-focus-glow
            size={46}
            className={cx(
              focusActive ? 'drop-shadow-[0_0_16px_rgb(var(--color-success)/0.32)]' : 'opacity-75 grayscale-[0.5]',
            )}
          />
          <div className="mt-2 text-[25px] font-bold tracking-[-0.025em] text-slate-100">
            {focusActive ? 'FOCUSED' : pausedUntil ? 'PAUSED' : 'UNPROTECTED'}
          </div>

          <button
            onClick={() => setListOpen(true)}
            className="flex items-center gap-2 rounded-full border border-white/[0.12] bg-white/[0.05] px-3 py-1 transition hover:bg-white/[0.09]"
          >
            {active.length === 0 ? (
              <ProfileDot color="rgb(148 163 184)" size={7} />
            ) : (
              active.slice(0, 4).map((p) => <ProfileDot key={p.profile.id} color={p.profile.color} size={7} />)
            )}
            <span className="whitespace-nowrap text-[12.5px] font-semibold text-slate-200">
              {only ? only.name : active.length > 1 ? `${active.length} profiles on` : 'No profile on'}
            </span>
            <span className="font-mono text-[9px] tracking-[0.06em] text-slate-400">PROFILES</span>
          </button>

          <div className="text-[12px] text-slate-400">
            {only ? profileSummary(only, aiMode) : focusActive ? 'blocking what any of them blocks' : 'nothing is being blocked'}
          </div>
        </div>
      </div>

      <div className="mt-[18px] flex flex-col items-center gap-[9px]">
        <div className="flex gap-2">
          {focusActive ? (
            <Button onClick={() => setOverridesOpen(true)} disabled={busy} variant="danger" className="rounded-full px-7 py-[11px] text-[13.5px]">
              Turn off…
            </Button>
          ) : (
            <Button
              onClick={() => void turnOn()}
              disabled={busy || pairedKeyRequired}
              variant={pairedKeyRequired ? 'ghost' : 'hero'}
              className="rounded-full px-7 py-[11px] text-[13.5px]"
            >
              Turn on focus
            </Button>
          )}
          {engine.overridden && (
            <Button onClick={() => void reenable()} disabled={busy} variant="ghost" className="rounded-full px-5 py-[11px] text-[13.5px]">
              Re-enable all
            </Button>
          )}
        </div>
        <StreakBadge streak={engine.streak} />
        {pairedKeyRequired && <p className="text-[12px] text-warn">pair a key to turn on focus</p>}
        {pausedUntil && <p className="text-[12px] text-slate-400">Paused until {formatClock(pausedUntil)}</p>}
        {lockedUntil > 0 && !message && (
          <p className="text-[12px] text-warn">A locked window holds blocking until {formatClock(lockedUntil)}.</p>
        )}
        {message && <p className="max-w-xs text-center text-[12px] text-warn">{message}</p>}
      </div>

      {listOpen && <ProfileList onClose={() => setListOpen(false)} />}
    </div>
  );
}
