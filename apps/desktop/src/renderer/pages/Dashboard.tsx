import React, { useEffect, useState } from 'react';
import type { UpcomingEvent } from '@talysman/shared';
import { palette } from '@talysman/shared';
import { useFocusStore } from '../store/useFocusStore.js';
import { FocusToggle } from '../components/FocusToggle.js';
import { Kicker, ProfileDot } from '../components/ui/index.js';
import { formatClock } from '../lib/engine.js';

const EVENT_VERB: Record<UpcomingEvent['kind'], string> = {
  windowStart: 'starts',
  windowEnd: 'ends',
  on: 'turns on',
  off: 'turns off',
};

export function Dashboard() {
  const engine = useFocusStore((s) => s.engine);
  const profiles = useFocusStore((s) => s.profiles);
  const [now, setNow] = useState(() => Date.now());

  // Keep upcoming event times current.
  useEffect(() => {
    const t = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(t);
  }, []);

  const nameOf = (id: string) => profiles.find((p) => p.id === id);

  return (
    <div className="dashboard-stage flex min-h-full flex-col items-center justify-center gap-8 py-6">
      <FocusToggle />

      {engine.nextEvents.length > 0 && (
        <div className="grid w-full max-w-2xl gap-3">
          <div className="instrument-card rounded-[14px] border border-white/[0.08] px-4 py-3.5">
            <Kicker className="text-caption tracking-[0.18em]">Coming up</Kicker>
            <ul className="mt-2 flex flex-col gap-1.5">
              {engine.nextEvents.slice(0, 4).map((event) => {
                const profile = nameOf(event.profileId);
                return (
                  <li key={`${event.profileId}:${event.atMs}:${event.kind}`} className="flex items-center gap-2 text-body text-slate-200">
                    <ProfileDot color={profile?.color ?? palette.colors.foregroundFaint} size={7} />
                    <span className="truncate">
                      {profile?.name ?? 'Profile'} {EVENT_VERB[event.kind]}
                    </span>
                    <span className="ml-auto font-mono text-caption text-slate-400">{formatClock(event.atMs, now)}</span>
                  </li>
                );
              })}
            </ul>
          </div>
        </div>
      )}
    </div>
  );
}
