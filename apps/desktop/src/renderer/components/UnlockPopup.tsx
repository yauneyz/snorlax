/**
 * The block/unlock popup (spec §3.10), shown in its own small window when the service closes a
 * blocked app. Same content as the extension's blocked page: who's blocking it, the streak, the
 * item's pool with unlocks left today, the pause (countdown or breathing) before an unlock, and a
 * way to the key-gated override options.
 */
import React, { useCallback, useEffect, useState } from 'react';
import type { PoolRef, PopupInfo, PopupTarget } from '@talysman/shared';
import { onEvent, request, closePopup, openOverrides } from '../lib/bridge.js';
import { formatClock } from '../lib/engine.js';
import { cx } from '../lib/utils.js';
import { Button, ProfileDot } from './ui/index.js';
import { StreakBadge } from './StreakBadge.js';

function useNow(intervalMs = 250): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = window.setInterval(() => setNow(Date.now()), intervalMs);
    return () => window.clearInterval(t);
  }, [intervalMs]);
  return now;
}

export function UnlockPopup({ target }: { target: PopupTarget }) {
  const [info, setInfo] = useState<PopupInfo | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const now = useNow();

  const load = useCallback(async () => {
    try {
      setInfo(await request('getPopupInfo', { target }));
    } catch (e) {
      setError((e as Error).message);
    }
  }, [target]);

  useEffect(() => {
    void load();
    return onEvent('stateChanged', () => void load());
  }, [load]);

  if (!info) {
    return <div className="flex h-full items-center justify-center text-slate-500">{error ?? 'Loading…'}</div>;
  }

  const refs: PoolRef[] = info.pools.map((p) => ({ profileId: p.profileId, poolId: p.poolId }));
  const pending = info.pending;
  const ready = !pending || pending.readyMs <= now;
  const minutes = Math.max(0, ...info.pools.map((p) => p.unlockMinutes));
  const left = Math.min(...info.pools.map((p) => p.leftToday));
  const perDay = Math.min(...info.pools.map((p) => p.unlocksPerDay));
  const unblocked = info.verdict.kind === 'allow';

  async function run(command: 'requestPoolUnlock' | 'confirmPoolUnlock') {
    setBusy(true);
    setError(null);
    try {
      await request('applyCommand', { command: { type: command, pools: refs } });
      const next = await request('getPopupInfo', { target });
      setInfo(next);
      if (next.verdict.kind === 'allow' || next.pools.some((p) => p.activeUntilMs !== null && p.activeUntilMs > Date.now())) {
        void closePopup();
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const secondsLeft = pending ? Math.max(0, Math.ceil((pending.readyMs - now) / 1000)) : 0;
  const breathing = info.friction.kind === 'breathing';

  return (
    <div className="flex h-full flex-col gap-4 p-5 text-slate-200 [-webkit-app-region:drag]">
      <div>
        <div className="text-[18px] font-semibold text-slate-100">{info.label}</div>
        {info.blockingProfiles.length > 0 && (
          <div className="mt-1 flex flex-wrap items-center gap-2 text-[12px] text-slate-400">
            Blocked by
            {info.blockingProfiles.map((p) => (
              <span key={p.id} className="flex items-center gap-1 text-slate-200">
                <ProfileDot color={p.color} size={7} />
                {p.name}
              </span>
            ))}
          </div>
        )}
      </div>

      <StreakBadge streak={info.streak} className="self-start" />

      {unblocked ? (
        <p className="text-[13px] text-okInk">Unlocked — you can open it now.</p>
      ) : info.pools.length > 0 ? (
        <div className="rounded-[12px] border border-white/[0.08] bg-white/[0.03] px-4 py-3">
          <div className="text-[13px] font-semibold text-slate-100">
            {info.pools.map((p) => p.name).join(' + ')} · {left} of {perDay} unlocks left today
          </div>
          <div className="mt-0.5 text-[12px] text-slate-400">Each unlock: {minutes} minutes</div>
          {info.unpooledProfiles.length > 0 && (
            <div className="mt-1 text-[12px] text-warn">
              Also blocked by a profile with no unlocks for this.
            </div>
          )}
          {left === 0 && <div className="mt-1 text-[12px] text-warn">Resets at midnight.</div>}
        </div>
      ) : (
        <p className="text-[12.5px] text-slate-400">This isn’t in an unlock pool.</p>
      )}

      {pending && !ready && (
        <div className="flex flex-col items-center gap-2 py-2">
          <div
            className={cx(
              'flex h-24 w-24 items-center justify-center rounded-full border border-signal/40 bg-signal/[0.08] font-mono text-[22px] text-slate-100',
              breathing && 'animate-[breathe_8s_ease-in-out_infinite]',
            )}
          >
            {secondsLeft}
          </div>
          <div className="text-[12px] text-slate-400">{breathing ? 'Breathe in… and out.' : 'Take a moment.'}</div>
        </div>
      )}

      <div className="mt-auto flex flex-col gap-2 [-webkit-app-region:no-drag]">
        {!unblocked && info.unlockAvailable && (
          <Button
            variant="hero"
            disabled={busy || (pending !== null && !ready)}
            onClick={() => void run(pending ? 'confirmPoolUnlock' : 'requestPoolUnlock')}
          >
            {pending && !ready ? `Unlock in ${secondsLeft} s` : `Unlock for ${minutes} min`}
          </Button>
        )}
        <Button variant="ghost" onClick={() => void closePopup()}>
          Not now
        </Button>
        <button onClick={() => void openOverrides()} className="text-[11.5px] text-slate-450 hover:text-slate-300">
          Other options ({info.emergencyLeft} emergency unlocks left)
          {info.lockedUntilMs !== null && ` · locked until ${formatClock(info.lockedUntilMs)}`}
        </button>
        {error && <p className="text-[12px] text-dangerInk">{error}</p>}
      </div>
    </div>
  );
}
