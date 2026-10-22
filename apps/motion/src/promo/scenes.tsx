/**
 * The promo's scenes. Each takes absolute start/end seconds, so a cut is just a different list
 * of the same scenes on a shorter timeline (see Promo.tsx).
 *
 * Feed rules these follow: the first frame already says something, every scene reads with the
 * sound off, the type sits in the middle of a 4:5 frame (clear of feed UI), and cuts are hard.
 */
import React, { useLayoutEffect, useRef, useState } from 'react';
import { AbsoluteFill, Easing, interpolate } from 'remotion';
import { TalysmanMark } from '../../../desktop/src/renderer/components/TalysmanMark';
import type { StateName } from '../fixtures';
import { alpha, c, fonts } from '../theme';
import { ramp, track, useTime } from '../ui/anim';
import { Callout, Pointer, Ring, center, useAnchors } from '../ui/Pointer';
import { APP_H, APP_W, RealApp } from '../ui/RealApp';
import { BLOCK_EVERY, HOOK_TOTAL, REFUSAL_LAG, hookCount, hookLands, type Span } from './timeline';
import { Backdrop, PROMO_W, PortEdge, Rise, Shockwave, Slam, UsbKey, impact, rgbSplit } from './fx';

const out = Easing.bezier(0.16, 1, 0.3, 1);
const inOut = Easing.bezier(0.65, 0, 0.35, 1);

/** Mounted only inside [from, to). No fades: feed video cuts hard. */
export function Cut({ from, to, children }: { from: number; to: number; children: React.ReactNode }) {
  const t = useTime();
  if (t < from || t >= to) return null;
  return <AbsoluteFill>{children}</AbsoluteFill>;
}

const column: React.CSSProperties = { alignItems: 'center', justifyContent: 'center', flexDirection: 'column', textAlign: 'center', padding: '0 70px' };

// ─── Hook ──────────────────────────────────────────────────────────────────────────────────────

function Toggle({ on, scale = 1 }: { on: boolean; scale?: number }) {
  const w = 300 * scale;
  const h = 160 * scale;
  const knob = h - 24 * scale;
  return (
    <div
      style={{
        position: 'relative',
        width: w,
        height: h,
        borderRadius: h,
        background: on ? c.signal : c.panelStrong,
        border: `3px solid ${on ? c.signalHigh : c.neutral700}`,
        boxShadow: on ? `0 0 90px ${alpha(c.signal, 0.55)}` : `inset 0 4px 20px ${alpha(c.black, 0.6)}`,
      }}
    >
      <div
        style={{
          position: 'absolute',
          top: 9 * scale,
          left: on ? w - knob - 15 * scale : 9 * scale,
          width: knob,
          height: knob,
          borderRadius: '50%',
          background: on ? c.signalInk : c.foregroundMuted,
          boxShadow: `0 8px 24px ${alpha(c.black, 0.5)}`,
        }}
      />
    </div>
  );
}

export function Hook({ from, to, total = HOOK_TOTAL }: { from: number; to: number; total?: number }) {
  const t = useTime();
  const span: Span = [from, to];
  const n = hookCount(span, t, total);
  const done = n >= total;
  const pop = impact(t, [hookLands(span)], 0.3);
  return (
    <Cut from={from} to={to}>
      <Backdrop glow={done ? c.danger : c.signal} strength={0.1} />
      <AbsoluteFill style={{ ...column, gap: 80 }}>
        <div style={{ fontFamily: fonts.sans, fontSize: 88, fontWeight: 700, letterSpacing: '-0.035em', lineHeight: 1.02, color: c.foregroundStrong }}>
          How many times
          <br />
          have you <span style={{ color: c.signal }}>turned off</span>
          <br />
          your blocker?
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 34 }}>
          <span style={{ fontFamily: fonts.mono, fontSize: 30, fontWeight: 700, letterSpacing: '0.2em', color: c.foregroundMuted }}>BLOCKER</span>
          <Toggle on={n % 2 === 0} scale={1.25} />
        </div>
        <div
          style={{
            fontFamily: fonts.mono,
            fontSize: 290,
            fontWeight: 800,
            lineHeight: 0.9,
            letterSpacing: '-0.06em',
            color: done ? c.dangerInk : c.foregroundStrong,
            transform: `scale(${1 + pop * 0.25})`,
            textShadow: rgbSplit(pop),
          }}
        >
          ×{n}
        </div>
        <div style={{ fontFamily: fonts.mono, fontSize: 30, letterSpacing: '0.2em', color: c.foregroundMuted, opacity: done ? 1 : 0 }}>THIS MONTH. SAME.</div>
      </AbsoluteFill>
    </Cut>
  );
}


// ─── Interrupt ─────────────────────────────────────────────────────────────────────────────────

/** Hard cut to full-bleed lime: the frame that stops the thumb. */
export function Interrupt({ from, to, lines }: { from: number; to: number; lines: { at: number; text: string }[] }) {
  return (
    <Cut from={from} to={to}>
      <AbsoluteFill style={{ background: c.signal }} />
      <AbsoluteFill style={{ ...column, gap: 6 }}>
        {lines.map((line) => (
          <Slam key={line.at} at={line.at} size={150} color={c.signalInk} weight={700}>
            {line.text}
          </Slam>
        ))}
      </AbsoluteFill>
    </Cut>
  );
}

// ─── The key and the port ──────────────────────────────────────────────────────────────────────

const SLOT_Y = 640;
const EDGE = 240;
/** Key x when plugged: the plug (0–160) sits inside the slot, the body flush with the edge. */
const IN_X = EDGE - 150;

/** The key flies in from the right, tilting, and clicks into the port at `click`. */
export function PlugIn({ from, to, click, caption }: { from: number; to: number; click: number; caption: { at: number; text: string; accent: string } }) {
  const t = useTime();
  const x = track(t, [
    { at: from, value: PROMO_W + 200 },
    { at: click - 0.08, value: IN_X + 30 },
    { at: click, value: IN_X },
  ]);
  const tilt = interpolate(t, [from, click - 0.15, click], [-24, -3, 0], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: out });
  const lit = ramp(t, click + 0.05, 0.25);
  const push = 1 + 0.06 * ramp(t, click, to - click, inOut);
  return (
    <Cut from={from} to={to}>
      <Backdrop glow={c.signal} strength={0.05 + 0.18 * lit} />
      <AbsoluteFill style={{ transform: `scale(${push})`, transformOrigin: `${EDGE}px ${SLOT_Y}px` }}>
        <div style={{ position: 'absolute', left: x, top: SLOT_Y - 90, transform: `rotate(${tilt}deg)`, transformOrigin: '0 90px' }}>
          <UsbKey led={lit} />
        </div>
        <PortEdge slotY={SLOT_Y} width={EDGE} glow={lit} />
        <Shockwave at={click} x={EDGE} y={SLOT_Y} size={1500} />
      </AbsoluteFill>
      <div style={{ position: 'absolute', left: 0, right: 0, top: 260, ...flexCol }}>
        <Rise at={from + 0.1} text="Pair any USB drive." size={66} color={c.foregroundSoft} />
      </div>
      <div style={{ position: 'absolute', left: 0, right: 0, top: 880, ...flexCol }}>
        <Slam at={caption.at} size={112}>
          {caption.text}
        </Slam>
        <Slam at={caption.at + 0.22} size={112} color={c.signal}>
          {caption.accent}
        </Slam>
      </div>
    </Cut>
  );
}

const flexCol: React.CSSProperties = { display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4, padding: '0 60px', textAlign: 'center' };

/** The key slides out and is flung off to another room. */
export function PullKey({ from, to, place }: { from: number; to: number; place: string }) {
  const t = useTime();
  const pull = from + 0.35;
  const fling = from + 0.85;
  const x = track(t, [
    { at: from, value: IN_X },
    { at: pull, value: IN_X + 260 },
    { at: fling, value: IN_X + 300 },
    { at: fling + 0.55, value: PROMO_W + 100 },
  ]);
  const y = track(t, [
    { at: fling, value: SLOT_Y - 90 },
    { at: fling + 0.55, value: -300 },
  ]);
  const spin = interpolate(t, [fling, fling + 0.55], [0, -38], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
  const shrink = interpolate(t, [fling, fling + 0.55], [1, 0.45], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
  const lit = 1 - ramp(t, from + 0.15, 0.15);
  const pin = ramp(t, fling + 0.4, 0.35, out);
  return (
    <Cut from={from} to={to}>
      <Backdrop glow={c.danger} strength={0.08 * (1 - lit)} />
      <div style={{ position: 'absolute', left: x, top: y, transform: `rotate(${spin}deg) scale(${shrink})`, transformOrigin: '280px 90px' }}>
        <UsbKey led={lit} />
      </div>
      <PortEdge slotY={SLOT_Y} width={EDGE} glow={lit} />
      <div style={{ position: 'absolute', left: 0, right: 0, top: 260, ...flexCol }}>
        <Slam at={from + 0.05} size={112}>
          Now pull the key
        </Slam>
      </div>
      {/* Where it went. */}
      <div
        style={{
          position: 'absolute',
          left: 0,
          right: 0,
          top: 900,
          display: 'flex',
          justifyContent: 'center',
          opacity: pin,
          transform: `translateY(${(1 - pin) * 30}px)`,
        }}
      >
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 18,
            padding: '22px 34px',
            borderRadius: 999,
            background: alpha(c.panelRaised, 0.9),
            border: `2px solid ${alpha(c.white, 0.12)}`,
            fontFamily: fonts.sans,
            fontSize: 46,
            fontWeight: 600,
            color: c.foregroundStrong,
          }}
        >
          <svg width="40" height="50" viewBox="0 0 24 30">
            <path d="M12 0C5.4 0 0 5.2 0 11.7 0 20.4 12 30 12 30s12-9.6 12-18.3C24 5.2 18.6 0 12 0z" fill={c.signal} />
            <circle cx="12" cy="11.5" r="4.5" fill={c.signalInk} />
          </svg>
          {place}
        </div>
      </div>
    </Cut>
  );
}

// ─── The real app, cropped tight ───────────────────────────────────────────────────────────────

const CARD_W = 960;
const CARD_H = 760;

/**
 * The real desktop app in a borderless card, zoomed onto the seal. `zoom` keys the camera; the
 * camera always centres the "FOCUSED" seal so a layout change in the app can't break the crop.
 */
export function AppCard({
  from,
  state,
  zoom,
  glow = c.success,
  overlay,
  targets = [],
  top = 520,
  aim = 70,
}: {
  from: number;
  state: StateName;
  zoom: { at: number; value: number }[];
  glow?: string;
  overlay?: (anchors: ReturnType<typeof useAnchors>) => React.ReactNode;
  targets?: string[];
  top?: number;
  /** How far below the seal's title the camera points, in app pixels. */
  aim?: number;
}) {
  const t = useTime();
  const root = useRef<HTMLDivElement>(null);
  // The app's store is filled in a child layout effect, after this card's first measure; one
  // more render picks the real layout up, so any single frame renders correctly on its own.
  const [, settle] = useState(false);
  useLayoutEffect(() => settle(true), []);
  const anchors = useAnchors(root, ['FOCUSED', ...targets]);
  const z = track(t, zoom);
  const f = anchors.FOCUSED ? center(anchors.FOCUSED) : { x: APP_W * 0.58, y: APP_H * 0.42 };
  const fy = f.y + aim;
  const enter = ramp(t, from, 0.35, out);
  return (
    <div
      style={{
        position: 'absolute',
        left: (PROMO_W - CARD_W) / 2,
        top: top - CARD_H / 2,
        width: CARD_W,
        height: CARD_H,
        borderRadius: 44,
        overflow: 'hidden',
        background: c.desktopBackground,
        border: `2px solid ${alpha(c.white, 0.1)}`,
        boxShadow: `0 50px 140px ${alpha(c.black, 0.8)}, 0 0 120px ${alpha(glow, 0.18)}`,
        opacity: enter,
        transform: `translateY(${(1 - enter) * 80}px) scale(${0.94 + 0.06 * enter})`,
      }}
    >
      <div
        style={{
          position: 'absolute',
          left: 0,
          top: 0,
          width: APP_W,
          height: APP_H,
          transformOrigin: '0 0',
          transform: `translate(${CARD_W / 2 - f.x * z}px, ${CARD_H / 2 - fy * z}px) scale(${z})`,
        }}
      >
        <div ref={root} style={{ position: 'relative', width: APP_W, height: APP_H }}>
          <RealApp state={state} />
          <div style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }}>{overlay?.(anchors)}</div>
        </div>
      </div>
    </div>
  );
}

/** Plugged in: the real app reads FOCUSED. */
export function Locked({ from, to }: { from: number; to: number }) {
  return (
    <Cut from={from} to={to}>
      <Backdrop glow={c.success} strength={0.14} />
      <div style={{ position: 'absolute', left: 0, right: 0, top: 150, ...flexCol }}>
        <Rise at={from + 0.05} text="Focus is on." size={92} weight={700} />
        <Rise at={from + 0.3} text="It stays on until the key says so." size={46} color={c.foregroundMuted} weight={500} />
      </div>
      <AppCard
        from={from}
        state="focused"
        top={800}
        zoom={[
          { at: from, value: 1.9 },
          { at: to, value: 2.15 },
        ]}
      />
    </Cut>
  );
}

/** Key gone: the pointer goes for "Turn off", and the app refuses. */
export function Refused({ from, to, click, title = 'Try turning it off.' }: { from: number; to: number; click: number; title?: string }) {
  const t = useTime();
  const nope = click + REFUSAL_LAG;
  return (
    <Cut from={from} to={to}>
      <Backdrop glow={c.danger} strength={0.06 + 0.12 * ramp(t, click, 0.3)} />
      <div style={{ position: 'absolute', left: 0, right: 0, top: 150, ...flexCol }}>
        <Rise at={from + 0.05} text={title} size={92} weight={700} />
      </div>
      <AppCard
        from={from}
        state="focusedNoKey"
        glow={c.danger}
        top={720}
        aim={130}
        targets={['Turn off']}
        zoom={[
          { at: from, value: 1.85 },
          { at: click - 0.1, value: 2.05 },
          { at: to, value: 2.25 },
        ]}
        overlay={(a) => (
          <>
            <Pointer start={{ x: (a.FOCUSED?.x ?? 600) + 260, y: (a.FOCUSED?.y ?? 300) + 260 }} anchors={a} keys={[{ at: click, to: 'Turn off', travel: 0.6 }, { at: click + 0.01, to: 'Turn off', click: true, travel: 0.01 }]} />
            <Ring anchor={a['Turn off']} from={click + 0.1} to={to} />
            <Callout anchor={a['Turn off']} text="Insert your key to turn off the blocker" from={click + 0.15} to={to} />
          </>
        )}
      />
      <div style={{ position: 'absolute', left: 0, right: 0, top: 1130, ...flexCol }}>
        <Slam at={nope} size={150} color={c.dangerInk} from={2.2}>
          You can’t.
        </Slam>
      </div>
    </Cut>
  );
}

// ─── Blocked ───────────────────────────────────────────────────────────────────────────────────

export type Site = { host: string; dot: string; note?: string };

export const SITES: Site[] = [
  { host: 'reddit.com', dot: '#ff4500', note: 'yes, even this one' },
  { host: 'youtube.com', dot: '#ff0033' },
  { host: 'x.com', dot: c.foregroundStrong },
  { host: 'instagram.com', dot: c.profilePink },
];

/** Each site slides in as an address bar, gets struck through and stamped. The list stacks up. */
export function Blocked({ from, to, sites = SITES, every = BLOCK_EVERY }: { from: number; to: number; sites?: Site[]; every?: number }) {
  const t = useTime();
  const first = from + 0.35;
  return (
    <Cut from={from} to={to}>
      <Backdrop glow={c.danger} strength={0.08} />
      <div style={{ position: 'absolute', left: 0, right: 0, top: 190, ...flexCol }}>
        <Rise at={from} text="Every feed that eats your day:" size={64} weight={700} />
      </div>
      {sites.map((site, i) => {
        const at = first + i * every;
        const stamp = at + every * 0.45;
        if (t < at) return null;
        const enter = ramp(t, at, 0.22, out);
        const strike = ramp(t, stamp - 0.12, 0.12);
        const hit = ramp(t, stamp, 0.16, Easing.bezier(0.34, 1.8, 0.64, 1));
        const k = impact(t, [stamp], 0.25);
        const stamped = t >= stamp;
        return (
          <div
            key={site.host}
            style={{
              position: 'absolute',
              left: 90,
              right: 90,
              top: 370 + i * 230,
              height: 150,
              transform: `translateX(${(1 - enter) * 900}px) skewX(${(1 - enter) * -14}deg)`,
              opacity: enter,
            }}
          >
            <div
              style={{
                position: 'absolute',
                inset: 0,
                display: 'flex',
                alignItems: 'center',
                gap: 26,
                padding: '0 40px',
                borderRadius: 999,
                background: c.panelRaised,
                border: `2px solid ${stamped ? alpha(c.danger, 0.5) : alpha(c.white, 0.12)}`,
                boxShadow: stamped ? `0 0 60px ${alpha(c.danger, 0.25)}` : `0 24px 60px ${alpha(c.black, 0.6)}`,
              }}
            >
              <span style={{ width: 34, height: 34, borderRadius: '50%', background: site.dot, opacity: stamped ? 0.35 : 1, flexShrink: 0 }} />
              <span style={{ position: 'relative', fontFamily: fonts.sans, fontSize: 64, fontWeight: 600, letterSpacing: '-0.02em', color: stamped ? c.foregroundDim : c.foregroundStrong }}>
                {site.host}
                <span style={{ position: 'absolute', left: -6, top: '54%', height: 7, width: `calc(${strike * 100}% + 12px)`, background: c.danger, borderRadius: 4 }} />
              </span>
            </div>
            {site.note ? (
              <div style={{ position: 'absolute', left: 104, top: 160, fontFamily: fonts.sans, fontSize: 34, fontWeight: 500, fontStyle: 'italic', color: c.signal, opacity: ramp(t, stamp + 0.12, 0.25), whiteSpace: 'nowrap' }}>
                ↑ {site.note}
              </div>
            ) : null}
            {stamped ? (
              <div
                style={{
                  position: 'absolute',
                  right: 20,
                  top: -26,
                  padding: '10px 22px',
                  border: `5px solid ${c.danger}`,
                  borderRadius: 14,
                  fontFamily: fonts.mono,
                  fontSize: 44,
                  fontWeight: 800,
                  letterSpacing: '0.12em',
                  color: c.dangerInk,
                  background: alpha(c.background, 0.85),
                  transform: `rotate(-8deg) scale(${interpolate(hit, [0, 1], [2.4, 1])})`,
                  opacity: Math.min(1, hit * 3),
                  textShadow: rgbSplit(k),
                }}
              >
                BLOCKED
              </div>
            ) : null}
          </div>
        );
      })}
    </Cut>
  );
}

// ─── Payoff ────────────────────────────────────────────────────────────────────────────────────

function clock(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

/** The urge passes; the focus timer races to a real afternoon. */
export function Payoff({ from, to, hours = 3.2 }: { from: number; to: number; hours?: number }) {
  const t = useTime();
  const p = ramp(t, from + 0.3, to - from - 0.6, Easing.bezier(0.3, 0, 0.1, 1));
  return (
    <Cut from={from} to={to}>
      <Backdrop glow={c.signal} strength={0.12} />
      <AbsoluteFill style={{ ...column, gap: 40 }}>
        <Rise at={from} text="The urge passes." size={92} weight={700} />
        <div
          style={{
            fontFamily: fonts.mono,
            fontSize: 170,
            fontWeight: 700,
            letterSpacing: '-0.04em',
            color: c.signal,
            textShadow: `0 0 80px ${alpha(c.signal, 0.45)}`,
            fontVariantNumeric: 'tabular-nums',
          }}
        >
          {clock(p * hours * 3600)}
        </div>
        <Rise at={from + 0.35} text="The work gets done." size={64} weight={600} color={c.foregroundSoft} />
      </AbsoluteFill>
    </Cut>
  );
}

// ─── End card ──────────────────────────────────────────────────────────────────────────────────

export function EndCard({ from, to }: { from: number; to: number }) {
  const t = useTime();
  const mark = ramp(t, from, 0.5, out);
  const cta = ramp(t, from + 0.55, 0.4, out);
  const breathe = 0.5 + 0.5 * Math.sin((t - from) * 3);
  return (
    <Cut from={from} to={to}>
      <Backdrop glow={c.signal} strength={0.16} />
      <Shockwave at={from} x={PROMO_W / 2} y={430} size={1300} color={c.brand} />
      <AbsoluteFill style={{ ...column, gap: 0 }}>
        <div style={{ transform: `scale(${0.6 + 0.4 * mark})`, opacity: mark, filter: `drop-shadow(0 0 ${40 + 30 * breathe}px ${alpha(c.signal, 0.35)})`, marginBottom: 30 }}>
          <TalysmanMark size={230} />
        </div>
        <div style={{ fontFamily: fonts.sans, fontSize: 84, fontWeight: 700, letterSpacing: '0.2em', color: c.foregroundStrong, opacity: mark, marginRight: '-0.2em' }}>TALYSMAN</div>
        <div style={{ marginTop: 36 }}>
          <Rise at={from + 0.25} text="The blocker with a physical key." size={56} weight={600} color={c.foregroundSoft} />
        </div>
        <div
          style={{
            marginTop: 70,
            padding: '30px 56px',
            borderRadius: 999,
            background: c.signal,
            color: c.signalInk,
            fontFamily: fonts.sans,
            fontSize: 50,
            fontWeight: 700,
            letterSpacing: '-0.01em',
            opacity: cta,
            transform: `translateY(${(1 - cta) * 40}px) scale(${1 + 0.02 * breathe})`,
            boxShadow: `0 0 ${60 + 40 * breathe}px ${alpha(c.signal, 0.45)}`,
          }}
        >
          Start free → talysman.app
        </div>
        <div style={{ marginTop: 40, fontFamily: fonts.mono, fontSize: 26, letterSpacing: '0.18em', color: c.foregroundMuted, opacity: ramp(t, from + 0.8, 0.4) }}>
          WINDOWS · MACOS · LINUX · ANY USB DRIVE
        </div>
      </AbsoluteFill>
    </Cut>
  );
}
