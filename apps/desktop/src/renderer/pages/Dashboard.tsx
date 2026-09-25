import React, { useEffect, useState } from 'react';
import type { UpcomingEvent } from '@talysman/shared';
import { palette } from '@talysman/shared';
import { useFocusStore } from '../store/useFocusStore.js';
import { FocusToggle } from '../components/FocusToggle.js';
import { Kicker, ProfileDot } from '../components/ui/index.js';
import { formatClock, formatDuration } from '../lib/engine.js';

/** One compact instrument reading — kicker on top, value below. */
function Readout({ label, value, tone }: { label: string; value: string; tone?: 'ok' | 'danger' }) {
  const color =
    tone === 'ok' ? 'text-okInk' : tone === 'danger' ? 'text-dangerInk' : 'text-slate-200';
  return (
    <div className="instrument-card rounded-[14px] border border-white/[0.08] px-4 py-3.5">
      <Kicker className="text-[9.5px] tracking-[0.18em]">{label}</Kicker>
      <div className={`mt-1.5 font-mono text-[15px] font-medium ${color}`}>{value}</div>
    </div>
  );
}

const EVENT_VERB: Record<UpcomingEvent['kind'], string> = {
  windowStart: 'starts',
  windowEnd: 'ends',
  on: 'turns on',
  off: 'turns off',
};

export function Dashboard() {
  const engine = useFocusStore((s) => s.engine);
  const keyPresent = useFocusStore((s) => s.keyPresent);
  const pairedKeys = useFocusStore((s) => s.pairedKeys);
  const profiles = useFocusStore((s) => s.profiles);
  const [now, setNow] = useState(() => Date.now());

  // Countdowns for unlocks and pauses.
  useEffect(() => {
    const t = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(t);
  }, []);

  const activeCount = engine.profiles.filter((p) => p.activation.active).length;
  const unlocked = engine.pools.filter((p) => p.activeUntilMs !== null && p.activeUntilMs > now);
  const nameOf = (id: string) => profiles.find((p) => p.id === id);
  const next = engine.nextEvents[0];

  return (
    <div className="dashboard-stage flex min-h-full flex-col items-center justify-center gap-8 py-6">
      <FocusToggle />

      <div className="grid w-full max-w-2xl grid-cols-2 gap-3 sm:grid-cols-4">
        <Readout
          label="Key"
          value={keyPresent ? 'present' : pairedKeys.length === 0 ? 'none paired' : 'away'}
          tone={keyPresent ? 'ok' : pairedKeys.length === 0 ? 'danger' : undefined}
        />
        <Readout label="Profiles on" value={`${activeCount}/${engine.profiles.length}`} />
        <Readout label="Emergency unlocks" value={`${engine.emergencyLeft} left`} tone={engine.emergencyLeft === 0 ? 'danger' : undefined} />
        <Readout
          label="Next change"
          value={next ? formatClock(next.atMs, now) : 'none'}
        />
      </div>

      {(unlocked.length > 0 || engine.nextEvents.length > 0) && (
        <div className="grid w-full max-w-2xl gap-3 sm:grid-cols-2">
          {unlocked.length > 0 && (
            <div className="instrument-card rounded-[14px] border border-white/[0.08] px-4 py-3.5">
              <Kicker className="text-[9.5px] tracking-[0.18em]">Unlocked now</Kicker>
              <ul className="mt-2 flex flex-col gap-1.5">
                {unlocked.map((pool) => (
                  <li key={`${pool.profileId}:${pool.poolId}`} className="flex items-center gap-2 text-[12.5px] text-slate-200">
                    <ProfileDot color={nameOf(pool.profileId)?.color ?? palette.colors.foregroundFaint} size={7} />
                    <span className="truncate">{pool.name}</span>
                    <span className="ml-auto font-mono text-[11px] text-slate-400">
                      {formatDuration((pool.activeUntilMs ?? now) - now)} left
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}
          {engine.nextEvents.length > 0 && (
            <div className="instrument-card rounded-[14px] border border-white/[0.08] px-4 py-3.5">
              <Kicker className="text-[9.5px] tracking-[0.18em]">Coming up</Kicker>
              <ul className="mt-2 flex flex-col gap-1.5">
                {engine.nextEvents.slice(0, 4).map((event) => {
                  const profile = nameOf(event.profileId);
                  return (
                    <li key={`${event.profileId}:${event.atMs}:${event.kind}`} className="flex items-center gap-2 text-[12.5px] text-slate-200">
                      <ProfileDot color={profile?.color ?? palette.colors.foregroundFaint} size={7} />
                      <span className="truncate">
                        {profile?.name ?? 'Profile'} {EVENT_VERB[event.kind]}
                      </span>
                      <span className="ml-auto font-mono text-[11px] text-slate-400">{formatClock(event.atMs, now)}</span>
                    </li>
                  );
                })}
              </ul>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
