/** The streak (spec §3.8): whole days without turning blocking off or loosening it. */
import React from 'react';
import type { Streak } from '@talysman/shared';
import { cx } from '../lib/utils.js';

export function StreakBadge({ streak, className }: { streak: Streak; className?: string }) {
  const best = streak.bestDays > streak.currentDays ? ` · best ${streak.bestDays}` : '';
  return (
    <span
      className={cx(
        'inline-flex items-center gap-1.5 rounded-full border border-warn/25 bg-warn/[0.08] px-3 py-1 text-[12px] font-semibold text-warn',
        className,
      )}
      title="Days without turning blocking off or loosening it. Pool unlocks don't count against it."
    >
      <span aria-hidden>🔥</span>
      {streak.currentDays}-day streak
      <span className="font-normal text-warn/70">{best}</span>
    </span>
  );
}
