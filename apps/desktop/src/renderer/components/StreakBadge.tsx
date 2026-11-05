/** A mode's streak (spec §3.8): whole days without turning it off or loosening it. `name` labels
 * whose streak it is when there's more than one mode. */
import React from 'react';
import type { Streak } from '@talysman/shared';
import { cx } from '../lib/utils.js';

export function StreakBadge({ streak, name, className }: { streak: Streak; name?: string; className?: string }) {
  const best = streak.bestDays > streak.currentDays ? ` · best ${streak.bestDays}` : '';
  return (
    <span
      className={cx(
        'inline-flex items-center gap-1.5 rounded-full border border-warn/25 bg-warn/[0.08] px-3 py-1 text-caption font-semibold text-warn',
        className,
      )}
      title="Days without turning this mode off or loosening it. Each mode keeps its own streak; unlocks from a group don't count against it."
    >
      <span aria-hidden>🔥</span>
      {streak.currentDays}-day streak
      <span className="font-normal text-warn/70">
        {name && ` · ${name}`}
        {best}
      </span>
    </span>
  );
}
