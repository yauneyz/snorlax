/**
 * Feed promos: 4:5, built to stop a scroll with the sound off. Not search-page demos — they're
 * registered separately in Root.tsx and rendered by scripts/promo.ts.
 *
 * Both cuts are lists of the same scenes on the timelines in timeline.ts, which the render
 * script also lays the sound on. Impacts drive the camera shake and flashes.
 */
import React from 'react';
import { AbsoluteFill } from 'remotion';
import { c, fonts } from '../theme';
import { useTime } from '../ui/anim';
import { Brand, Finish, Flash, Shake } from './fx';
import { Blocked, EndCard, Hook, Interrupt, Locked, Payoff, PlugIn, PullKey, Refused, SITES } from './scenes';
import { HERO, REFUSAL_LAG, SHORT, blockStamps, hookLands } from './timeline';

function Frame({ impacts, flashes, brandUntil, children }: { impacts: number[]; flashes: number[]; brandUntil: number; children: React.ReactNode }) {
  const t = useTime();
  return (
    <AbsoluteFill style={{ background: c.background, fontFamily: fonts.sans, color: c.foreground }}>
      <Shake impacts={impacts}>{children}</Shake>
      {/* Brand from frame one, off the lime frames (where it would vanish) and the end card. */}
      <Brand opacity={t < brandUntil ? 1 : 0} />
      <Flash at={flashes} />
      <Finish />
    </AbsoluteFill>
  );
}

// ─── Hero cut, 18s ─────────────────────────────────────────────────────────────────────────────

const H = HERO;

export function PromoHero() {
  const t = useTime();
  const lime = t >= H.interrupt[0] && t < H.interrupt[1];
  return (
    <Frame
      impacts={[hookLands(H.hook), ...H.lines.map((l) => l.at), H.click, ...blockStamps(H.blocked, H.sites), H.refuseClick + 0.1, H.refuseClick + REFUSAL_LAG]}
      flashes={[H.click, H.end[0]]}
      brandUntil={lime ? -1 : H.end[0]}
    >
      <Hook from={H.hook[0]} to={H.hook[1]} />
      <Interrupt from={H.interrupt[0]} to={H.interrupt[1]} lines={[...H.lines]} />
      <PlugIn from={H.plug[0]} to={H.plug[1]} click={H.click} caption={{ at: H.click + 0.2, text: 'Plug it in.', accent: 'Focus locks.' }} />
      <Locked from={H.locked[0]} to={H.locked[1]} />
      <Blocked from={H.blocked[0]} to={H.blocked[1]} sites={SITES.slice(0, H.sites)} />
      <PullKey from={H.pull[0]} to={H.pull[1]} place="Kitchen drawer · 2 rooms away" />
      <Refused from={H.refused[0]} to={H.refused[1]} click={H.refuseClick} />
      <Payoff from={H.payoff[0]} to={H.payoff[1]} />
      <EndCard from={H.end[0]} to={H.end[1]} />
    </Frame>
  );
}

export const PROMO_HERO_SECONDS = H.end[1];

// ─── Cutdown, 7s ───────────────────────────────────────────────────────────────────────────────

const S = SHORT;

export function PromoShort() {
  return (
    <Frame impacts={[hookLands(S.hook), S.click, S.refuseClick + 0.1, S.refuseClick + REFUSAL_LAG]} flashes={[S.click, S.end[0]]} brandUntil={S.end[0]}>
      <Hook from={S.hook[0]} to={S.hook[1]} />
      <PlugIn from={S.plug[0]} to={S.plug[1]} click={S.click} caption={{ at: S.click + 0.15, text: 'This one', accent: 'needs a key.' }} />
      <Refused from={S.refused[0]} to={S.refused[1]} click={S.refuseClick} title="Key’s in the kitchen?" />
      <EndCard from={S.end[0]} to={S.end[1]} />
    </Frame>
  );
}

export const PROMO_SHORT_SECONDS = S.end[1];
