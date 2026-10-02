/**
 * What the dashboard's pause/unlock button opens (spec §3.5). With the key in: pause everything
 * until a chosen time (key-gated, breaks the streak). Without it: a temporary unlock of one of an
 * active profile's unlock groups — keyless, limited per day, behind a short countdown. The group
 * last unlocked here is preselected. Emergency unlocks live in Settings.
 */
import React, { useEffect, useState } from 'react';
import type { PoolRef, PoolStatus } from '@talysman/shared';
import { useFocusStore } from '../store/useFocusStore.js';
import { formatClock, runCommand } from '../lib/engine.js';
import { cx } from '../lib/utils.js';
import { Button, Modal } from './ui/index.js';
import { StreakBadge } from './StreakBadge.js';

const PAUSE_PRESETS = [10, 30, 60, 120];
const UNLOCK_COUNTDOWN_SECS = 5;
const LAST_POOL_KEY = 'talysman.lastUnlockPool';

const poolKey = (p: PoolRef) => `${p.profileId}/${p.poolId}`;

function readLastPool(): string | null {
  try {
    return window.localStorage.getItem(LAST_POOL_KEY);
  } catch {
    return null;
  }
}

function writeLastPool(key: string) {
  try {
    window.localStorage.setItem(LAST_POOL_KEY, key);
  } catch {
    // Remembering the choice is a convenience; nothing breaks without it.
  }
}

function chipClass(on: boolean) {
  return cx(
    'rounded-full border px-3 py-1 text-caption transition',
    on ? 'border-white/25 bg-white/[0.10] text-slate-100' : 'border-white/[0.08] text-slate-400 hover:bg-white/[0.05]',
  );
}

export function OverrideDialog({ onClose }: { onClose: () => void }) {
  const keyPresent = useFocusStore((s) => s.keyPresent);
  return keyPresent ? <PauseUntil onClose={onClose} /> : <TemporaryUnlock onClose={onClose} />;
}

function useRun(onClose: () => void) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function run(command: Parameters<typeof runCommand>[0], after?: () => void) {
    setBusy(true);
    setError(null);
    try {
      await runCommand(command);
      after?.();
      onClose();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return { busy, error, run };
}

function PauseUntil({ onClose }: { onClose: () => void }) {
  const streak = useFocusStore((s) => s.engine.streak);
  const showStreak = useFocusStore((s) => s.settings.streakBadgeEnabled);
  const [minutes, setMinutes] = useState(30);
  const [custom, setCustom] = useState('');
  const { busy, error, run } = useRun(onClose);

  const pauseMinutes = custom ? Number(custom) : minutes;
  const valid = pauseMinutes >= 1 && pauseMinutes <= 720;

  return (
    <Modal title="Pause until…" onClose={onClose} width={420}>
      {showStreak && <StreakBadge streak={streak} />}
      <div className="mt-4 flex flex-wrap items-center gap-1.5">
        {PAUSE_PRESETS.map((m) => (
          <button
            key={m}
            onClick={() => {
              setMinutes(m);
              setCustom('');
            }}
            aria-pressed={!custom && minutes === m}
            className={chipClass(!custom && minutes === m)}
          >
            {m < 60 ? `${m} min` : `${m / 60} h`}
          </button>
        ))}
        <input
          type="number"
          min={1}
          max={720}
          placeholder="Custom min"
          aria-label="Custom minutes"
          value={custom}
          onChange={(e) => setCustom(e.target.value)}
          className="w-28 rounded-full border border-white/[0.10] bg-white/[0.04] px-3 py-1 text-caption text-slate-100 outline-none"
        />
      </div>
      <div className="mt-4 flex items-center justify-between gap-3">
        <span className="text-body text-slate-400">
          {valid ? (
            <>
              Back on at <span className="font-mono text-slate-100">{formatClock(Date.now() + pauseMinutes * 60_000)}</span>
            </>
          ) : (
            'Pick 1 minute to 12 hours.'
          )}
        </span>
        <Button
          variant="danger"
          disabled={busy || !valid}
          onClick={() => void run({ type: 'startOverrideTimed', minutes: Math.round(pauseMinutes) })}
        >
          Pause
        </Button>
      </div>
      <p className="mt-3 text-caption text-slate-450">Uses your key and resets your streak.</p>
      {error && <p className="mt-3 text-caption text-dangerInk">{error}</p>}
    </Modal>
  );
}

function TemporaryUnlock({ onClose }: { onClose: () => void }) {
  const engine = useFocusStore((s) => s.engine);
  const activeIds = new Set(engine.profiles.filter((p) => p.activation.active).map((p) => p.profile.id));
  const pools = engine.pools.filter((p) => activeIds.has(p.profileId));
  const [selected, setSelected] = useState<string | null>(() => {
    const last = readLastPool();
    return pools.find((p) => poolKey(p) === last) ? last : pools[0] ? poolKey(pools[0]) : null;
  });
  const [countdown, setCountdown] = useState(UNLOCK_COUNTDOWN_SECS);
  const { busy, error, run } = useRun(onClose);

  useEffect(() => {
    if (countdown <= 0) return;
    const t = window.setTimeout(() => setCountdown((c) => c - 1), 1000);
    return () => window.clearTimeout(t);
  }, [countdown]);

  const pool: PoolStatus | undefined = pools.find((p) => poolKey(p) === selected);
  const profileName = (id: string) => engine.profiles.find((p) => p.profile.id === id)?.profile.name ?? id;
  const showProfile = new Set(pools.map((p) => p.profileId)).size > 1;

  return (
    <Modal title="Temporary unlock" onClose={onClose} width={440}>
      <p className="text-body text-slate-400">No key plugged in. Unlock one group for a while instead.</p>

      {pools.length === 0 ? (
        <p className="mt-4 text-body text-slate-300">
          None of the profiles that are on has an unlock group. Insert your key to pause.
        </p>
      ) : (
        <>
          <div className="mt-4 flex flex-col gap-1.5" role="radiogroup" aria-label="Unlock group">
            {pools.map((p) => {
              const key = poolKey(p);
              const on = key === selected;
              const unlockedUntil = p.activeUntilMs !== null && p.activeUntilMs > Date.now() ? p.activeUntilMs : null;
              return (
                <button
                  key={key}
                  role="radio"
                  aria-checked={on}
                  onClick={() => setSelected(key)}
                  className={cx(
                    'flex items-center gap-3 rounded-[12px] border px-4 py-2.5 text-left transition',
                    on ? 'border-white/25 bg-white/[0.08]' : 'border-white/[0.08] bg-white/[0.02] hover:bg-white/[0.05]',
                  )}
                >
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-body font-semibold text-slate-100">
                      {p.name}
                      {showProfile && <span className="font-normal text-slate-400"> · {profileName(p.profileId)}</span>}
                    </span>
                    <span className="block text-caption text-slate-400">
                      {unlockedUntil
                        ? `Unlocked until ${formatClock(unlockedUntil)}`
                        : `${p.unlockMinutes} min each · ${p.leftToday} of ${p.unlocksPerDay} left today`}
                    </span>
                  </span>
                </button>
              );
            })}
          </div>
          <div className="mt-4 flex justify-end gap-2">
            <Button variant="ghost" onClick={onClose}>
              Cancel
            </Button>
            <Button
              variant="danger"
              disabled={busy || countdown > 0 || !pool || pool.leftToday === 0}
              onClick={() => {
                if (!pool) return;
                const ref = { profileId: pool.profileId, poolId: pool.poolId };
                void run({ type: 'confirmPoolUnlock', pools: [ref] }, () => writeLastPool(poolKey(ref)));
              }}
            >
              {countdown > 0
                ? `Unlock in ${countdown}…`
                : pool && pool.leftToday === 0
                  ? 'None left today'
                  : `Unlock for ${pool?.unlockMinutes ?? 0} min`}
            </Button>
          </div>
        </>
      )}
      {error && <p className="mt-3 text-caption text-dangerInk">{error}</p>}
    </Modal>
  );
}
