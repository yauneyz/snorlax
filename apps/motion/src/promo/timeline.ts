/**
 * The promos' timelines, in seconds. Plain data with no React, so scripts/promo.ts can lay the
 * sound effects on the same beats the picture hits.
 */
import { Easing } from 'remotion';
import { ramp } from '../ui/anim';

export type Span = readonly [number, number];

export const HOOK_TOTAL = 47;

/** The hook's counter: races from 1 to the total, accelerating; each step flips the toggle. */
export function hookCount([from, to]: Span, t: number, total = HOOK_TOTAL): number {
  const p = ramp(t, from + 0.15, to - from - 0.5, Easing.bezier(0.55, 0, 0.9, 0.6));
  return Math.max(1, Math.round(p * total));
}

/** When the count lands on the total. */
export const hookLands = ([, to]: Span) => to - 0.35;

export const BLOCK_EVERY = 0.55;
export const blockStamps = ([from]: Span, count: number, every = BLOCK_EVERY) => Array.from({ length: count }, (_, i) => from + 0.35 + i * every + every * 0.45);

export const HERO = {
  hook: [0, 3.4],
  interrupt: [3.4, 5.2],
  lines: [
    { at: 3.4, text: 'What if' },
    { at: 3.85, text: 'it needed' },
    { at: 4.3, text: 'a key?' },
  ],
  plug: [5.2, 7.8],
  click: 6.25,
  locked: [7.8, 10.3],
  blocked: [10.3, 13.9],
  sites: 4,
  /** Slower than the default so the list gets savored. */
  blockEvery: 0.75,
  pull: [13.9, 16.1],
  refused: [16.1, 19.3],
  refuseClick: 16.85,
  payoff: [19.3, 21.5],
  end: [21.5, 25.0],
} as const;

export const SHORT = {
  hook: [0, 1.9],
  plug: [1.9, 3.3],
  click: 2.45,
  refused: [3.3, 5.1],
  refuseClick: 3.85,
  end: [5.1, 7.0],
} as const;

/** "You can't." lands this long after the click on "Turn off". */
export const REFUSAL_LAG = 0.55;

export type Sfx = 'tick' | 'thump' | 'slam' | 'whoosh' | 'plug' | 'stamp' | 'buzz' | 'chime' | 'riser' | 'unplug';
export type Cue = { at: number; sfx: Sfx; gain?: number };

/** Toggle ticks for the hook, thinned so the fastest stretch is a rattle, not a smear. */
function hookTicks(hook: Span): Cue[] {
  const cues: Cue[] = [];
  let last = hookCount(hook, hook[0]);
  let lastAt = -1;
  for (let f = Math.round(hook[0] * 30); f < Math.round(hook[1] * 30); f += 1) {
    const t = f / 30;
    const n = hookCount(hook, t);
    if (n !== last && t - lastAt >= 0.06) {
      cues.push({ at: t, sfx: 'tick', gain: 0.8 });
      lastAt = t;
    }
    last = n;
  }
  return cues;
}

export const HERO_CUES: Cue[] = [
  { at: 0, sfx: 'tick' },
  ...hookTicks(HERO.hook),
  { at: hookLands(HERO.hook), sfx: 'thump' },
  ...HERO.lines.map((l): Cue => ({ at: l.at, sfx: 'slam' })),
  { at: HERO.plug[0] + 0.05, sfx: 'whoosh' },
  { at: HERO.click, sfx: 'plug' },
  { at: HERO.click, sfx: 'thump', gain: 0.9 },
  { at: HERO.locked[0], sfx: 'whoosh', gain: 0.6 },
  ...blockStamps(HERO.blocked, HERO.sites, HERO.blockEvery).map((at): Cue => ({ at, sfx: 'stamp' })),
  { at: HERO.pull[0] + 0.2, sfx: 'unplug' },
  { at: HERO.pull[0] + 1.1, sfx: 'whoosh' },
  { at: HERO.refuseClick, sfx: 'tick' },
  { at: HERO.refuseClick + 0.1, sfx: 'buzz' },
  { at: HERO.refuseClick + REFUSAL_LAG, sfx: 'thump' },
  { at: HERO.payoff[0], sfx: 'riser' },
  { at: HERO.end[0], sfx: 'chime' },
];

export const SHORT_CUES: Cue[] = [
  { at: 0, sfx: 'tick' },
  ...hookTicks(SHORT.hook),
  { at: hookLands(SHORT.hook), sfx: 'thump' },
  { at: SHORT.plug[0] + 0.05, sfx: 'whoosh' },
  { at: SHORT.click, sfx: 'plug' },
  { at: SHORT.click, sfx: 'thump', gain: 0.9 },
  { at: SHORT.refuseClick, sfx: 'tick' },
  { at: SHORT.refuseClick + 0.1, sfx: 'buzz' },
  { at: SHORT.refuseClick + REFUSAL_LAG, sfx: 'thump' },
  { at: SHORT.end[0] - 0.6, sfx: 'riser', gain: 0.7 },
  { at: SHORT.end[0], sfx: 'chime' },
];
