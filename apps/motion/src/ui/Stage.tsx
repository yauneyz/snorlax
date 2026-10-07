/**
 * The frame every demo sits in: background, brand, and the caption track that carries the page's
 * beats. A demo is a list of scenes placed on one timeline in absolute seconds, plus its beats.
 */
import React from 'react';
import { AbsoluteFill } from 'remotion';
import { TalysmanMark } from '../../../desktop/src/renderer/components/TalysmanMark';
import { alpha, c, fonts } from '../theme';
import { ramp, useTime, visible } from './anim';

export type Beat = {
  /** Seconds. The beat shows from here until the next one starts (or `until`). */
  at: number;
  until?: number;
  /** Short mono label — a clock time, a step name. */
  label: string;
  text: string;
};

export function Stage({
  beats,
  eyebrow,
  children,
}: {
  beats: Beat[];
  /** Top-right context: what the page is about. */
  eyebrow?: string;
  children: React.ReactNode;
}) {
  return (
    <AbsoluteFill style={{ background: c.background, fontFamily: fonts.sans, color: c.foreground }}>
      <AbsoluteFill
        style={{
          background: `radial-gradient(ellipse 70% 55% at 50% 42%, ${alpha(c.panelStrong, 0.55)}, transparent 70%)`,
        }}
      />
      <Grid />
      {children}
      {/* Keeps the brand legible when the camera pushes a window up under it. */}
      <div style={{ position: 'absolute', inset: '0 0 auto 0', height: 130, background: `linear-gradient(${c.background}, ${alpha(c.background, 0.85)} 55%, transparent)` }} />
      <Brand eyebrow={eyebrow} />
      <Captions beats={beats} />
    </AbsoluteFill>
  );
}

function Grid() {
  return (
    <AbsoluteFill
      style={{
        backgroundImage: `linear-gradient(${alpha(c.white, 0.025)} 1px, transparent 1px), linear-gradient(90deg, ${alpha(c.white, 0.025)} 1px, transparent 1px)`,
        backgroundSize: '64px 64px',
        maskImage: 'radial-gradient(ellipse 80% 70% at 50% 45%, black, transparent)',
      }}
    />
  );
}

function Brand({ eyebrow }: { eyebrow?: string }) {
  return (
    <div
      style={{
        position: 'absolute',
        top: 44,
        left: 64,
        right: 64,
        display: 'flex',
        alignItems: 'center',
        gap: 14,
      }}
    >
      <TalysmanMark size={34} />
      <span style={{ fontSize: 20, fontWeight: 700, letterSpacing: '0.18em', color: c.neutral150 }}>TALYSMAN</span>
      {eyebrow ? (
        <span
          style={{
            marginLeft: 'auto',
            fontFamily: fonts.mono,
            fontSize: 18,
            letterSpacing: '0.16em',
            textTransform: 'uppercase',
            color: c.foregroundMuted,
          }}
        >
          {eyebrow}
        </span>
      ) : null}
    </div>
  );
}

function Captions({ beats }: { beats: Beat[] }) {
  const t = useTime();
  return (
    <>
      {beats.map((beat, index) => {
        const end = beat.until ?? beats[index + 1]?.at ?? Infinity;
        const shown = visible(t, beat.at, end, 0.3);
        if (shown <= 0) return null;
        const rise = 1 - ramp(t, beat.at, 0.45);
        return (
          <div
            key={`${beat.at}-${beat.label}`}
            style={{
              position: 'absolute',
              left: 0,
              right: 0,
              bottom: 56,
              display: 'flex',
              justifyContent: 'center',
              opacity: shown,
              transform: `translateY(${rise * 14}px)`,
            }}
          >
            <div
              style={{
                display: 'flex',
                alignItems: 'baseline',
                gap: 22,
                maxWidth: 1500,
                padding: '18px 30px',
                borderRadius: 18,
                background: alpha(c.panel, 0.88),
                border: `1px solid ${alpha(c.white, 0.08)}`,
                boxShadow: `0 20px 60px ${alpha(c.black, 0.5)}`,
              }}
            >
              <span
                style={{
                  fontFamily: fonts.mono,
                  fontSize: 22,
                  fontWeight: 600,
                  letterSpacing: '0.12em',
                  textTransform: 'uppercase',
                  color: c.signal,
                  whiteSpace: 'nowrap',
                }}
              >
                {beat.label}
              </span>
              <span style={{ fontSize: 34, fontWeight: 500, lineHeight: 1.25, color: c.foregroundStrong }}>{beat.text}</span>
            </div>
          </div>
        );
      })}
    </>
  );
}

/**
 * One scene on the shared timeline. Unmounted outside [from, to]; fades and settles in/out at
 * the edges. `origin` positions it — scenes are laid out in the stage's coordinate space.
 */
export function Scene({
  from,
  to,
  children,
  fade = 0.45,
  style,
}: {
  from: number;
  to: number;
  children: React.ReactNode;
  fade?: number;
  style?: React.CSSProperties;
}) {
  const t = useTime();
  if (t < from || t > to) return null;
  const shown = visible(t, from, to, fade);
  const settle = 1 - ramp(t, from, fade * 1.6);
  return (
    <AbsoluteFill style={{ opacity: shown, transform: `scale(${1 + settle * 0.025})`, ...style }}>{children}</AbsoluteFill>
  );
}
