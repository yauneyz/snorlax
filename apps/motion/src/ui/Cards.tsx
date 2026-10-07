/**
 * Title and end cards, and the plain desk scenes (an editor, a document, an app launching) that
 * the demos cut to between moments in Talysman.
 */
import React from 'react';
import { AbsoluteFill } from 'remotion';
import { FREE_BLOCKED_SITE_LIMIT } from '@talysman/product';
import { TalysmanMark } from '../../../desktop/src/renderer/components/TalysmanMark';
import { alpha, c, fonts } from '../theme';
import { ramp, typed, useTime, visible } from './anim';
import { OsWindow, type Platform } from './Window';
import { RealAppBlockedPopup } from './RealApp';

/** Opens on the question, typed into a search box — the query the page answers. */
export function SearchIntro({ query, answer }: { query: string; answer: string }) {
  const t = useTime();
  const q = typed(query, t, 0.3, 22);
  const done = q.length === query.length;
  const doneAt = 0.3 + query.length / 22;
  const a = ramp(t, doneAt + 0.4, 0.6);
  return (
    <AbsoluteFill style={{ alignItems: 'center', justifyContent: 'center', gap: 46 }}>
      <div
        style={{
          width: 1100,
          height: 84,
          borderRadius: 99,
          border: `1px solid ${alpha(c.white, 0.16)}`,
          background: c.panel,
          display: 'flex',
          alignItems: 'center',
          gap: 22,
          padding: '0 36px',
          fontSize: 34,
          color: c.foregroundStrong,
          boxShadow: `0 30px 80px ${alpha(c.black, 0.5)}`,
        }}
      >
        <svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke={c.foregroundMuted} strokeWidth="2.2" strokeLinecap="round">
          <circle cx="11" cy="11" r="7" />
          <path d="M20 20l-4-4" />
        </svg>
        <span>
          {q}
          {!done && Math.floor(t * 2.5) % 2 === 0 ? <span style={{ color: c.signal }}>|</span> : null}
        </span>
      </div>
      <div
        style={{
          maxWidth: 1300,
          textAlign: 'center',
          fontSize: 54,
          fontWeight: 700,
          lineHeight: 1.15,
          letterSpacing: '-0.02em',
          color: c.foregroundStrong,
          opacity: a,
          transform: `translateY(${(1 - a) * 16}px)`,
        }}
      >
        {answer}
      </div>
    </AbsoluteFill>
  );
}

export function EndCard({ from, headline, slug }: { from: number; headline: string; slug: string }) {
  const t = useTime() - from;
  const a = ramp(t, 0.1, 0.6);
  const b = ramp(t, 0.6, 0.6);
  return (
    <AbsoluteFill style={{ alignItems: 'center', justifyContent: 'center', gap: 28, background: c.background }}>
      <div style={{ opacity: a, transform: `scale(${0.9 + 0.1 * a})` }}>
        <TalysmanMark size={96} />
      </div>
      <div style={{ opacity: a, fontSize: 64, fontWeight: 700, letterSpacing: '-0.02em', color: c.foregroundStrong, textAlign: 'center', maxWidth: 1400, lineHeight: 1.1 }}>
        {headline}
      </div>
      <div style={{ opacity: b, display: 'flex', gap: 18, alignItems: 'center', fontSize: 28, color: c.foregroundMuted }}>
        <span style={{ fontFamily: fonts.mono, color: c.signal }}>talysman.app/{slug}</span>
        <span>·</span>
        <span>Free forever for {FREE_BLOCKED_SITE_LIMIT} sites</span>
      </div>
    </AbsoluteFill>
  );
}

/** A short list of facts, revealed one at a time — for the moments a picture can't carry. */
export function Points({ from, title, points, step = 0.7 }: { from: number; title: string; points: { label: string; text: string; tone?: 'ok' | 'no' | 'plain' }[]; step?: number }) {
  const t = useTime() - from;
  return (
    <AbsoluteFill style={{ alignItems: 'center', justifyContent: 'center' }}>
      <div style={{ width: 1300, transform: 'translateY(-40px)', display: 'flex', flexDirection: 'column', gap: 16 }}>
        <div style={{ fontSize: 44, fontWeight: 700, color: c.foregroundStrong, marginBottom: 14, opacity: ramp(t, 0, 0.4) }}>{title}</div>
        {points.map((point, index) => {
          const a = ramp(t, 0.5 + index * step, 0.4);
          const mark = point.tone === 'no' ? '✕' : point.tone === 'ok' ? '✓' : '→';
          const color = point.tone === 'no' ? c.dangerInk : point.tone === 'ok' ? c.signal : c.foregroundMuted;
          return (
            <div
              key={point.label}
              style={{
                display: 'grid',
                gridTemplateColumns: '48px 420px 1fr',
                alignItems: 'baseline',
                padding: '18px 26px',
                borderRadius: 14,
                background: alpha(c.panelRaised, 0.85),
                border: `1px solid ${alpha(c.white, 0.07)}`,
                opacity: a,
                transform: `translateX(${(1 - a) * -16}px)`,
              }}
            >
              <span style={{ fontSize: 26, fontWeight: 700, color }}>{mark}</span>
              <span style={{ fontFamily: fonts.mono, fontSize: 22, color: c.foregroundStrong }}>{point.label}</span>
              <span style={{ fontSize: 24, color: c.foregroundSoft }}>{point.text}</span>
            </div>
          );
        })}
      </div>
    </AbsoluteFill>
  );
}

/** An editor or document with text being written — the work the session protects. */
export function Desk({
  kind,
  platform = 'windows',
  lines,
  typeFrom,
}: {
  kind: 'code' | 'doc';
  platform?: Platform;
  lines: string[];
  typeFrom?: number;
}) {
  const t = useTime();
  const all = lines.join('\n');
  const shown = typeFrom === undefined ? all : typed(all, t, typeFrom, 26);
  return (
    <AbsoluteFill style={{ alignItems: 'center', justifyContent: 'center' }}>
      <div style={{ transform: 'translateY(-40px)' }}>
        <OsWindow platform={platform} title={kind === 'code' ? 'main.rs — editor' : 'Draft — chapter 3'} width={1240} height={620}>
          <div
            style={{
              height: '100%',
              padding: kind === 'code' ? '28px 34px' : '56px 160px',
              background: kind === 'code' ? c.neutral900 : c.panel,
              fontFamily: kind === 'code' ? fonts.mono : 'Georgia, serif',
              fontSize: kind === 'code' ? 22 : 27,
              lineHeight: kind === 'code' ? 1.6 : 1.7,
              color: c.foreground,
              whiteSpace: 'pre-wrap',
            }}
          >
            {shown}
            <span style={{ display: 'inline-block', width: 2, height: '1.1em', verticalAlign: 'text-bottom', background: Math.floor(t * 2.2) % 2 ? 'transparent' : c.foregroundStrong }} />
          </div>
        </OsWindow>
      </div>
    </AbsoluteFill>
  );
}

/**
 * An app launching mid-session and the service closing it within about a second, followed by
 * the real popup the desktop app shows for a blocked app.
 */
export function AppClosed({ name, launches, platform = 'windows' }: { name: string; launches: number[]; platform?: Platform }) {
  const t = useTime();
  const last = launches[launches.length - 1]!;
  return (
    <AbsoluteFill style={{ alignItems: 'center', justifyContent: 'center' }}>
      {launches.map((at) => {
        const open = visible(t, at, at + 1.1, 0.25);
        if (open <= 0) return null;
        return (
          <div key={at} style={{ position: 'absolute', opacity: open, transform: `translateY(-40px) scale(${0.94 + 0.06 * open})` }}>
            <OsWindow platform={platform} title={name} width={1100} height={600}>
              <div style={{ height: '100%', display: 'flex', background: c.neutral900 }}>
                <div style={{ width: 90, background: alpha(c.black, 0.4) }} />
                <div style={{ width: 260, background: alpha(c.white, 0.03) }} />
                <div style={{ flex: 1, display: 'grid', placeItems: 'center', fontSize: 22, color: c.foregroundDim }}>Loading {name}…</div>
              </div>
            </OsWindow>
          </div>
        );
      })}
      {t > last + 1.2 ? (
        <div style={{ position: 'absolute', transform: `translateY(-40px) scale(${0.96 + 0.04 * ramp(t, last + 1.2, 0.3)})`, opacity: ramp(t, last + 1.2, 0.3) }}>
          <OsWindow platform={platform} title="Talysman" width={420} height={380}>
            <RealAppBlockedPopup state="focusedNoKey" />
          </OsWindow>
        </div>
      ) : null}
    </AbsoluteFill>
  );
}
