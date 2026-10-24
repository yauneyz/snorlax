/**
 * Feed promos: 4:5, plus a 9:16 hero for short-form (TikTok, Reels, Shorts), built to stop a
 * scroll with the sound off. Not search-page demos — they're
 * registered separately in Root.tsx and rendered by scripts/promo.ts.
 *
 * Both cuts are lists of the same scenes on the timelines in timeline.ts, which the render
 * script also lays the sound on. Impacts drive the camera shake and flashes.
 */
import React from 'react';
import { AbsoluteFill } from 'remotion';
import { c, fonts } from '../theme';
import { useTime } from '../ui/anim';
import { BleedProvider, Brand, Finish, Flash, PROMO_H, PROMO_W, Shake } from './fx';
import { Blocked, Cover, EndCard, Hook, Interrupt, Locked, Payoff, PlugIn, PullKey, Refused, SITES } from './scenes';
import { HERO, REFUSAL_LAG, SHORT, blockStamps, hookLands } from './timeline';

export const VERTICAL_H = 1920;

/**
 * Where the 4:5 stage sits in the 9:16 frame: shrunk a little so the stamps and cards clear the
 * right-hand button rail, and raised so nothing lands under the caption and audio bar at the
 * bottom or the tabs at the top.
 */
const VERTICAL_STAGE = { scale: 0.94, top: 200 };

/** The scenes' 1080×1350 stage, as is or placed inside the 9:16 frame with the rest as bleed. */
function Stage({ vertical, centered = false, children }: { vertical: boolean; centered?: boolean; children: React.ReactNode }) {
  if (!vertical) return <>{children}</>;
  const k = VERTICAL_STAGE.scale;
  // A cover has no UI over it, so it sits dead centre instead.
  const top = centered ? (VERTICAL_H - PROMO_H * k) / 2 : VERTICAL_STAGE.top;
  const left = (PROMO_W * (1 - k)) / 2;
  const bleed = { x: left / k, top: top / k, bottom: (VERTICAL_H - top - PROMO_H * k) / k };
  return (
    <div style={{ position: 'absolute', left, top, width: PROMO_W, height: PROMO_H, transform: `scale(${k})`, transformOrigin: '0 0' }}>
      <BleedProvider value={bleed}>{children}</BleedProvider>
    </div>
  );
}

function Frame({ impacts, flashes, brandUntil, vertical = false, children }: { impacts: number[]; flashes: number[]; brandUntil: number; vertical?: boolean; children: React.ReactNode }) {
  const t = useTime();
  return (
    <AbsoluteFill style={{ background: c.background, fontFamily: fonts.sans, color: c.foreground }}>
      <Shake impacts={impacts}>
        <Stage vertical={vertical}>{children}</Stage>
      </Shake>
      {/* Brand from frame one, off the lime frames (where it would vanish) and the end card. */}
      <Stage vertical={vertical}>
        <Brand opacity={t < brandUntil ? 1 : 0} />
      </Stage>
      <Flash at={flashes} />
      <Finish />
    </AbsoluteFill>
  );
}

// ─── Hero cut, 25s ─────────────────────────────────────────────────────────────────────────────

const H = HERO;

export function PromoHero({ vertical = false }: { vertical?: boolean }) {
  const t = useTime();
  const lime = t >= H.interrupt[0] && t < H.interrupt[1];
  return (
    <Frame
      vertical={vertical}
      impacts={[hookLands(H.hook), ...H.lines.map((l) => l.at), H.click, ...blockStamps(H.blocked, H.sites, H.blockEvery), H.refuseClick + 0.1, H.refuseClick + REFUSAL_LAG]}
      flashes={[H.click, H.end[0]]}
      brandUntil={lime ? -1 : H.end[0]}
    >
      <Hook from={H.hook[0]} to={H.hook[1]} />
      <Interrupt from={H.interrupt[0]} to={H.interrupt[1]} lines={[...H.lines]} />
      <PlugIn from={H.plug[0]} to={H.plug[1]} click={H.click} caption={{ at: H.click + 0.2, text: 'This becomes', accent: 'your key.' }} />
      <Locked from={H.locked[0]} to={H.locked[1]} />
      <Blocked from={H.blocked[0]} to={H.blocked[1]} sites={SITES.slice(0, H.sites)} every={H.blockEvery} />
      <PullKey from={H.pull[0]} to={H.pull[1]} place="Kitchen drawer · 2 rooms away" />
      <Refused from={H.refused[0]} to={H.refused[1]} click={H.refuseClick} />
      <Payoff from={H.payoff[0]} to={H.payoff[1]} />
      <EndCard from={H.end[0]} to={H.end[1]} note="Link in bio" />
    </Frame>
  );
}

/** The hero at 9:16 for TikTok, Reels and Shorts. */
export const PromoHeroVertical = () => <PromoHero vertical />;

export const PROMO_HERO_SECONDS = H.end[1];

/** The hero's thumbnail, in either format. */
export function PromoCover({ vertical = false }: { vertical?: boolean }) {
  return (
    <AbsoluteFill style={{ background: c.background, fontFamily: fonts.sans, color: c.foreground }}>
      <Stage vertical={vertical} centered>
        <Cover />
        <Brand />
      </Stage>
      <Finish />
    </AbsoluteFill>
  );
}

export const PromoCoverVertical = () => <PromoCover vertical />;

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
