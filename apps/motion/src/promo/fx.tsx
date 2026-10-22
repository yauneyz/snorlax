/**
 * Effects for the feed promos: grain, impacts (shake, flash, shockwave, RGB split), kinetic type,
 * and the USB key itself. Everything is a pure function of time, like the rest of the motion app.
 */
import React from 'react';
import { AbsoluteFill, Easing, interpolate, useCurrentFrame } from 'remotion';
import { TalysmanMark } from '../../../desktop/src/renderer/components/TalysmanMark';
import { alpha, c, fonts } from '../theme';
import { ramp, useTime } from '../ui/anim';

export const PROMO_W = 1080;
export const PROMO_H = 1350;

const out = Easing.bezier(0.16, 1, 0.3, 1);
const back = Easing.bezier(0.34, 1.56, 0.64, 1);

/** 1 at an impact, decaying to 0 over `decay` seconds; the strongest of several impacts. */
export function impact(t: number, at: number[], decay = 0.35): number {
  return at.reduce((m, a) => (t >= a && t < a + decay ? Math.max(m, Math.pow(1 - (t - a) / decay, 2)) : m), 0);
}

/** A camera that kicks on every impact. Deterministic noise, so every render is the same. */
export function Shake({ impacts, strength = 26, children }: { impacts: number[]; strength?: number; children: React.ReactNode }) {
  const t = useTime();
  const k = impact(t, impacts) * strength;
  const x = Math.sin(t * 93.1) * k;
  const y = Math.cos(t * 71.7) * k * 0.8;
  const r = Math.sin(t * 57.3) * k * 0.03;
  return <AbsoluteFill style={{ transform: `translate(${x}px, ${y}px) rotate(${r}deg)` }}>{children}</AbsoluteFill>;
}

/** Red/cyan text split, scaled by an impact — reads as a hit even on a phone at arm's length. */
export function rgbSplit(k: number): string | undefined {
  if (k <= 0.01) return undefined;
  const d = 10 * k;
  return `${-d}px 0 ${alpha('#ff2d55', 0.75 * k)}, ${d}px 0 ${alpha(c.desktopSignal, 0.75 * k)}`;
}

/** A full-frame white flash at each impact. */
export function Flash({ at, color = c.white, peak = 0.28, decay = 0.16 }: { at: number[]; color?: string; peak?: number; decay?: number }) {
  const t = useTime();
  const k = impact(t, at, decay);
  if (k <= 0) return null;
  return <AbsoluteFill style={{ background: color, opacity: k * peak, mixBlendMode: 'screen' }} />;
}

/** Expanding rings from a point. */
export function Shockwave({ at, x, y, color = c.signal, size = 900 }: { at: number; x: number; y: number; color?: string; size?: number }) {
  const t = useTime();
  return (
    <>
      {[0, 0.09, 0.18].map((lag, i) => {
        const p = ramp(t, at + lag, 0.75, out);
        if (p <= 0 || p >= 1) return null;
        const d = size * p;
        return (
          <div
            key={lag}
            style={{
              position: 'absolute',
              left: x - d / 2,
              top: y - d / 2,
              width: d,
              height: d,
              borderRadius: '50%',
              border: `${(3 - i) * 3 * (1 - p) + 1}px solid ${alpha(color, (1 - p) * (0.9 - i * 0.2))}`,
              boxShadow: `0 0 ${60 * (1 - p)}px ${alpha(color, 0.5 * (1 - p))}, inset 0 0 ${40 * (1 - p)}px ${alpha(color, 0.3 * (1 - p))}`,
            }}
          />
        );
      })}
    </>
  );
}

/** Film grain and a vignette over everything: kills banding in the gradients and looks less "template". */
export function Finish() {
  const frame = useCurrentFrame();
  return (
    <>
      <AbsoluteFill style={{ background: `radial-gradient(ellipse 90% 75% at 50% 45%, transparent 55%, ${alpha(c.black, 0.65)})`, pointerEvents: 'none' }} />
      <AbsoluteFill style={{ opacity: 0.09, mixBlendMode: 'overlay', pointerEvents: 'none' }}>
        <svg width="100%" height="100%">
          <filter id="promo-grain">
            <feTurbulence type="fractalNoise" baseFrequency="0.85" numOctaves="2" seed={frame % 12} stitchTiles="stitch" />
            <feColorMatrix type="saturate" values="0" />
          </filter>
          <rect width="100%" height="100%" filter="url(#promo-grain)" />
        </svg>
      </AbsoluteFill>
    </>
  );
}

/** A grid floor that drifts — depth behind the type without competing with it. */
export function Backdrop({ glow = c.signal, strength = 0.12 }: { glow?: string; strength?: number }) {
  const t = useTime();
  return (
    <AbsoluteFill style={{ background: c.background }}>
      <AbsoluteFill style={{ background: `radial-gradient(ellipse 70% 45% at 50% 50%, ${alpha(glow, strength)}, transparent 70%)` }} />
      <AbsoluteFill
        style={{
          backgroundImage: `linear-gradient(${alpha(c.white, 0.045)} 1px, transparent 1px), linear-gradient(90deg, ${alpha(c.white, 0.045)} 1px, transparent 1px)`,
          backgroundSize: '72px 72px',
          backgroundPosition: `0 ${(t * 24) % 72}px`,
          maskImage: 'radial-gradient(ellipse 75% 60% at 50% 50%, black, transparent)',
        }}
      />
    </AbsoluteFill>
  );
}

/**
 * A word that slams in: oversized and blurred, snapping to size with a little overshoot. Hits
 * are where the camera shakes, so pass the same `at` to the stage's impacts.
 */
export function Slam({
  at,
  children,
  size = 120,
  color = c.foregroundStrong,
  weight = 700,
  from = 1.7,
  style,
}: {
  at: number;
  children: React.ReactNode;
  size?: number;
  color?: string;
  weight?: number;
  /** Starting scale. */
  from?: number;
  style?: React.CSSProperties;
}) {
  const t = useTime();
  const p = ramp(t, at, 0.22, back);
  const k = impact(t, [at], 0.25);
  return (
    <span
      style={{
        display: 'inline-block',
        fontFamily: fonts.sans,
        fontSize: size,
        fontWeight: weight,
        lineHeight: 0.95,
        letterSpacing: '-0.035em',
        color,
        visibility: t < at ? 'hidden' : 'visible',
        opacity: Math.min(1, ramp(t, at, 0.06) * 1.2),
        transform: `scale(${interpolate(p, [0, 1], [from, 1])})`,
        filter: `blur(${(1 - ramp(t, at, 0.12)) * 14}px)`,
        textShadow: rgbSplit(k),
        ...style,
      }}
    >
      {children}
    </span>
  );
}

/** Rises in word by word — for the quieter lines between hits. */
export function Rise({ at, text, size = 64, color = c.foregroundStrong, weight = 600, step = 0.06, style }: { at: number; text: string; size?: number; color?: string; weight?: number; step?: number; style?: React.CSSProperties }) {
  const t = useTime();
  return (
    <span style={{ fontFamily: fonts.sans, fontSize: size, fontWeight: weight, color, letterSpacing: '-0.025em', lineHeight: 1.08, ...style }}>
      {text.split(' ').map((word, i) => {
        const p = ramp(t, at + i * step, 0.4, out);
        return (
          <span key={`${word}-${i}`} style={{ display: 'inline-block', overflow: 'hidden', verticalAlign: 'top', paddingBottom: '0.08em' }}>
            <span style={{ display: 'inline-block', transform: `translateY(${(1 - p) * 105}%)`, opacity: p > 0 ? 1 : 0 }}>{word}&nbsp;</span>
          </span>
        );
      })}
    </span>
  );
}

/** Mark + wordmark, small, for brand recall from the first frame. */
export function Brand({ opacity = 1 }: { opacity?: number }) {
  return (
    <div style={{ position: 'absolute', top: 54, left: 0, right: 0, display: 'flex', justifyContent: 'center', alignItems: 'center', gap: 14, opacity }}>
      <TalysmanMark size={40} />
      <span style={{ fontFamily: fonts.sans, fontSize: 24, fontWeight: 700, letterSpacing: '0.22em', color: c.neutral150 }}>TALYSMAN</span>
    </div>
  );
}

/**
 * A USB-A thumb drive, drawn at 560×180 with the plug pointing left (x 0–150). `led` lights the
 * status light from 0 to 1.
 */
export function UsbKey({ led = 0, style }: { led?: number; style?: React.CSSProperties }) {
  return (
    <svg width={560} height={180} viewBox="0 0 560 180" style={{ overflow: 'visible', ...style }}>
      <defs>
        <linearGradient id="usb-body" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#3b3d42" />
          <stop offset="0.45" stopColor="#1d1e21" />
          <stop offset="1" stopColor="#0d0d0f" />
        </linearGradient>
        <linearGradient id="usb-sheen" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stopColor="#fff" stopOpacity="0" />
          <stop offset="0.5" stopColor="#fff" stopOpacity="0.16" />
          <stop offset="1" stopColor="#fff" stopOpacity="0" />
        </linearGradient>
        <linearGradient id="usb-metal" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#f2f3f5" />
          <stop offset="0.5" stopColor="#9aa0a8" />
          <stop offset="1" stopColor="#d6d9de" />
        </linearGradient>
      </defs>
      {/* plug */}
      <rect x="0" y="40" width="160" height="100" rx="6" fill="url(#usb-metal)" />
      <rect x="34" y="62" width="30" height="20" rx="2" fill="#2a2c30" />
      <rect x="92" y="62" width="30" height="20" rx="2" fill="#2a2c30" />
      <rect x="0" y="40" width="160" height="6" fill="#fff" opacity="0.5" />
      {/* body */}
      <rect x="140" y="0" width="420" height="180" rx="36" fill="url(#usb-body)" stroke="#45484e" strokeWidth="2" />
      <rect x="160" y="12" width="380" height="54" rx="26" fill="url(#usb-sheen)" />
      {/* lanyard hole */}
      <circle cx="512" cy="90" r="16" fill="#060607" stroke="#45484e" strokeWidth="2" />
      {/* engraved mark */}
      <TalysmanMark size={80} x={276} y={50} opacity={0.85} />
      <text x="368" y="100" fontFamily={fonts.sans} fontWeight={700} fontSize="26" letterSpacing="5" fill="#c7ccd4" opacity="0.8">
        KEY
      </text>
      {/* status light */}
      <circle cx="472" cy="90" r="9" fill={led > 0 ? c.signal : '#26282c'} opacity={0.35 + 0.65 * led} />
      {led > 0 ? <circle cx="472" cy="90" r={9 + 18 * led} fill={alpha(c.signal, 0.25 * led)} /> : null}
    </svg>
  );
}

/** The side of a laptop with a USB-A slot, filling the left edge. Drawn over the key so the plug disappears into it. */
export function PortEdge({ slotY, glow = 0, width = 300 }: { slotY: number; glow?: number; width?: number }) {
  return (
    <div style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width }}>
      <div
        style={{
          position: 'absolute',
          inset: 0,
          background: 'linear-gradient(90deg, #0b0b0c, #1b1c1f 80%, #34363b 97%, #4a4d53)',
          boxShadow: `20px 0 60px ${alpha(c.black, 0.8)}`,
        }}
      />
      {/* slot */}
      <div
        style={{
          position: 'absolute',
          right: -2,
          top: slotY - 60,
          width: 40,
          height: 120,
          borderRadius: '8px 0 0 8px',
          background: '#030303',
          border: `2px solid ${glow > 0 ? alpha(c.signal, 0.4 + 0.6 * glow) : '#55585e'}`,
          borderRight: 'none',
          boxShadow: glow > 0 ? `0 0 ${50 * glow}px ${alpha(c.signal, 0.7 * glow)}` : undefined,
        }}
      />
    </div>
  );
}
