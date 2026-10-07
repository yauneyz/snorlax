/**
 * Lock types side by side, each meeting the same urge at the same moment. Panels are schematic —
 * they show how each kind of lock is ended, not any product's interface — and their labels
 * follow the competitor claims on the pages (each of which cites the vendor's own docs).
 */
import React from 'react';
import { AbsoluteFill } from 'remotion';
import { alpha, c, fonts } from '../theme';
import { ramp, useTime } from './anim';

export type LockPanel = {
  title: string;
  subtitle: string;
  kind: 'type' | 'timer' | 'weekly' | 'key';
  outcome: string;
  /** Red for a lock that gave way (or that you'll stop using), lime for one that held. */
  held: boolean;
};

/** Deterministic noise for the "type this to unlock" string. */
const NOISE = 'q8Zr!vT2m@Lx9#pK4wN7$bY1&fH6sJ3*eD5uG0^cR8nW2%aM9oI4tE7yP1lV6hB3kS0zX5jF8gQ2'.repeat(4);

function Visual({ kind, t, urge }: { kind: LockPanel['kind']; t: number; urge: number }) {
  const box: React.CSSProperties = {
    height: 200,
    borderRadius: 14,
    background: c.panel,
    border: `1px solid ${alpha(c.white, 0.08)}`,
    padding: 22,
    display: 'flex',
    flexDirection: 'column',
    justifyContent: 'center',
    gap: 14,
  };

  if (kind === 'type') {
    const p = ramp(t, urge, 4.2, (x) => x);
    const count = Math.floor(p * 200);
    return (
      <div style={box}>
        <div style={{ fontFamily: fonts.mono, fontSize: 15, lineHeight: 1.5, color: c.foregroundSoft, height: 92, overflow: 'hidden', wordBreak: 'break-all' }}>
          {NOISE.slice(0, count)}
          <span style={{ color: c.foregroundFaint }}>{NOISE.slice(count, 200)}</span>
        </div>
        <div style={{ height: 6, borderRadius: 3, background: alpha(c.white, 0.08) }}>
          <div style={{ height: 6, borderRadius: 3, width: `${p * 100}%`, background: p >= 1 ? c.danger : c.foregroundMuted }} />
        </div>
        <div style={{ fontFamily: fonts.mono, fontSize: 15, color: c.foregroundDim }}>{count} / 200 characters</div>
      </div>
    );
  }

  if (kind === 'timer') {
    const left = Math.max(0, 3 * 3600 - 42 * 60 - Math.floor(t));
    const hh = Math.floor(left / 3600);
    const mm = String(Math.floor((left % 3600) / 60)).padStart(2, '0');
    const ss = String(left % 60).padStart(2, '0');
    return (
      <div style={{ ...box, alignItems: 'center' }}>
        <div style={{ fontFamily: fonts.mono, fontSize: 52, fontWeight: 600, color: c.foregroundStrong }}>{`${hh}:${mm}:${ss}`}</div>
        <div style={{ fontSize: 17, color: c.foregroundDim }}>remaining · no way to end it</div>
      </div>
    );
  }

  if (kind === 'weekly') {
    const clicked = t > urge + 1.4;
    return (
      <div style={{ ...box, alignItems: 'center' }}>
        <span
          style={{
            padding: '12px 26px',
            borderRadius: 10,
            fontSize: 19,
            fontWeight: 600,
            background: clicked ? alpha(c.danger, 0.18) : alpha(c.white, 0.08),
            color: clicked ? c.dangerInk : c.foregroundStrong,
            border: `1px solid ${alpha(c.white, 0.12)}`,
          }}
        >
          {clicked ? 'Session ended' : 'End locked session'}
        </span>
        <div style={{ fontSize: 17, color: c.foregroundDim }}>{clicked ? 'Next one available in 7 days' : 'Web dashboard · once every 7 days'}</div>
      </div>
    );
  }

  return (
    <div style={{ ...box, alignItems: 'center' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '6px 14px', borderRadius: 99, border: `1px solid ${alpha(c.danger, 0.35)}`, background: alpha(c.danger, 0.1) }}>
        <span style={{ width: 8, height: 8, borderRadius: 99, background: c.danger, boxShadow: `0 0 10px ${c.danger}` }} />
        <span style={{ fontFamily: fonts.mono, fontSize: 14, letterSpacing: '0.12em', color: c.dangerInk }}>NO KEY</span>
      </div>
      <span style={{ padding: '11px 30px', borderRadius: 99, fontSize: 18, color: alpha(c.dangerInk, 0.55), background: alpha(c.danger, 0.08), border: `1px solid ${alpha(c.danger, 0.2)}` }}>
        Turn off
      </span>
      <div style={{ fontSize: 17, color: c.foregroundDim }}>Key: kitchen counter, two rooms away</div>
    </div>
  );
}

export function Locks({ panels, from, urge, outcomeAt }: { panels: LockPanel[]; from: number; urge: number; outcomeAt: number }) {
  const t = useTime() - from;
  return (
    <AbsoluteFill style={{ alignItems: 'center', justifyContent: 'center' }}>
      <div style={{ display: 'flex', gap: 30, transform: `translateY(-40px) scale(${panels.length > 3 ? 1.08 : panels.length === 3 ? 1.15 : 1.35})` }}>
        {panels.map((panel, index) => {
          const enter = ramp(t, 0.2 + index * 0.25, 0.5);
          const out = ramp(t, outcomeAt - from + index * 0.35, 0.4);
          const ours = panel.kind === 'key';
          return (
            <div
              key={panel.title}
              style={{
                width: panels.length > 3 ? 400 : 500,
                padding: 26,
                borderRadius: 20,
                background: alpha(c.panelRaised, 0.9),
                border: `1px solid ${ours ? alpha(c.signal, 0.45) : alpha(c.white, 0.08)}`,
                opacity: enter,
                transform: `translateY(${(1 - enter) * 20}px)`,
                display: 'flex',
                flexDirection: 'column',
                gap: 18,
              }}
            >
              <div>
                <div style={{ fontSize: 28, fontWeight: 700, color: ours ? c.signal : c.foregroundStrong }}>{panel.title}</div>
                <div style={{ fontSize: 18, color: c.foregroundMuted, marginTop: 4 }}>{panel.subtitle}</div>
              </div>
              <Visual kind={panel.kind} t={t} urge={urge - from} />
              <div
                style={{
                  minHeight: 56,
                  fontSize: 21,
                  lineHeight: 1.35,
                  fontWeight: 500,
                  color: panel.held ? c.signal : c.dangerInk,
                  opacity: out,
                }}
              >
                {panel.outcome}
              </div>
            </div>
          );
        })}
      </div>
    </AbsoluteFill>
  );
}
