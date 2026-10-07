/**
 * A browser window, and what loads in it: the extension's real block page, real captures of
 * sites with site rules applied, or a schematic of a site's layout where we have no capture.
 */
import React from 'react';
import { AbsoluteFill, IFrame, Img, staticFile } from 'remotion';
import { alpha, c, fonts } from '../theme';
import { useTime, typed } from './anim';
import type { Platform } from './Window';

export const BROWSER_W = 1280;
export const BROWSER_H = 760;
const CHROME = 86;

export function Browser({
  url,
  typeFrom,
  title,
  platform = 'windows',
  children,
  scale = 1.0,
  offset = { x: 0, y: -30 },
}: {
  url: string;
  /** Type the URL into the address bar from this time; omit to show it already loaded. */
  typeFrom?: number;
  title: string;
  platform?: Platform;
  children: React.ReactNode;
  scale?: number;
  offset?: { x: number; y: number };
}) {
  const t = useTime();
  const shown = typeFrom === undefined ? url : typed(url, t, typeFrom, 16);
  const caret = typeFrom !== undefined && shown.length < url.length && Math.floor(t * 2.5) % 2 === 0;
  const loaded = typeFrom === undefined || shown.length === url.length;

  return (
    <AbsoluteFill style={{ alignItems: 'center', justifyContent: 'center' }}>
      <div
        style={{
          transform: `translate(${offset.x}px, ${offset.y}px) scale(${scale})`,
          width: BROWSER_W,
          height: BROWSER_H + CHROME,
          borderRadius: platform === 'windows' ? 8 : 12,
          overflow: 'hidden',
          background: c.panel,
          border: `1px solid ${alpha(c.white, 0.12)}`,
          boxShadow: `0 40px 120px ${alpha(c.black, 0.7)}`,
          fontFamily: fonts.sans,
        }}
      >
        <div style={{ height: 40, display: 'flex', alignItems: 'flex-end', gap: 8, padding: '0 12px', background: c.neutral900 }}>
          {platform === 'mac' ? (
            <div style={{ display: 'flex', gap: 8, alignSelf: 'center', marginRight: 10 }}>
              {[c.danger, c.warning, c.success].map((color) => (
                <span key={color} style={{ width: 12, height: 12, borderRadius: 99, background: color, opacity: 0.85 }} />
              ))}
            </div>
          ) : null}
          <div
            style={{
              height: 32,
              width: 260,
              padding: '0 14px',
              display: 'flex',
              alignItems: 'center',
              borderRadius: '10px 10px 0 0',
              background: c.panelRaised,
              fontSize: 14,
              color: c.foregroundSoft,
              overflow: 'hidden',
              whiteSpace: 'nowrap',
            }}
          >
            {loaded ? title : 'New Tab'}
          </div>
        </div>
        <div style={{ height: 46, display: 'flex', alignItems: 'center', gap: 14, padding: '0 16px', background: c.panelRaised, borderBottom: `1px solid ${alpha(c.white, 0.06)}` }}>
          <span style={{ color: c.foregroundDim, fontSize: 18, letterSpacing: 6 }}>‹ › ↻</span>
          <div
            style={{
              flex: 1,
              height: 32,
              borderRadius: 99,
              background: c.background,
              display: 'flex',
              alignItems: 'center',
              padding: '0 16px',
              fontSize: 16,
              color: c.foreground,
              fontFamily: fonts.sans,
            }}
          >
            {shown}
            {caret ? <span style={{ width: 2, height: 18, background: c.foregroundStrong, marginLeft: 1 }} /> : null}
          </div>
        </div>
        <div style={{ position: 'relative', width: BROWSER_W, height: BROWSER_H, background: c.background, overflow: 'hidden' }}>
          {loaded ? children : null}
        </div>
      </div>
    </AbsoluteFill>
  );
}

/** The extension's block page, as built — what a blocked site turns into. */
export function BlockPage() {
  return <IFrame src={staticFile('extension/blocked.html')} style={{ width: BROWSER_W, height: BROWSER_H, border: 0 }} />;
}

/** A real capture of a site with focus on (scripts/capture-browser.ts). */
export function Capture({ src }: { src: string }) {
  return <Img src={staticFile(src)} style={{ width: BROWSER_W, display: 'block' }} />;
}

// ── Schematics ──────────────────────────────────────────────────────────────────────────────
// Sites we have no capture of are drawn as neutral layouts: grey blocks where content is, and a
// dashed outline where a site rule removed something. They show the shape of the page, not the
// site's branding or anyone's content.

const block = (style: React.CSSProperties): React.CSSProperties => ({
  borderRadius: 10,
  background: alpha(c.white, 0.06),
  ...style,
});

export function Hidden({ label, style }: { label: string; style: React.CSSProperties }) {
  return (
    <div
      style={{
        position: 'absolute',
        borderRadius: 12,
        border: `2px dashed ${alpha(c.signal, 0.45)}`,
        background: alpha(c.signal, 0.04),
        display: 'grid',
        placeItems: 'center',
        fontFamily: fonts.mono,
        fontSize: 15,
        letterSpacing: '0.12em',
        textTransform: 'uppercase',
        color: alpha(c.signal, 0.8),
        textAlign: 'center',
        padding: 12,
        ...style,
      }}
    >
      {label}
    </div>
  );
}

function SiteHeader({ name, search }: { name: string; search?: string }) {
  return (
    <div style={{ height: 64, display: 'flex', alignItems: 'center', gap: 24, padding: '0 28px', borderBottom: `1px solid ${alpha(c.white, 0.06)}` }}>
      <span style={{ fontSize: 22, fontWeight: 700, color: c.foregroundStrong, width: 180 }}>{name}</span>
      <div
        style={{
          flex: 1,
          maxWidth: 560,
          height: 40,
          borderRadius: 99,
          border: `1px solid ${alpha(c.white, 0.12)}`,
          display: 'flex',
          alignItems: 'center',
          padding: '0 18px',
          fontSize: 16,
          color: search ? c.foregroundStrong : c.foregroundDim,
        }}
      >
        {search ?? 'Search'}
      </div>
      <div style={{ marginLeft: 'auto', display: 'flex', gap: 12 }}>
        {[0, 1, 2].map((i) => (
          <span key={i} style={{ width: 32, height: 32, borderRadius: 99, background: alpha(c.white, 0.08) }} />
        ))}
      </div>
    </div>
  );
}

/** A video site's home page with the feed rule on: header and search remain, no feed. */
export function VideoHome() {
  return (
    <AbsoluteFill>
      <SiteHeader name="youtube.com" />
      <Hidden label="Home feed hidden by site rule" style={{ left: 40, right: 40, top: 100, bottom: 40 }} />
    </AbsoluteFill>
  );
}

/** Search results: allowed by default, minus the unrelated shelves. */
export function VideoSearch({ query }: { query: string }) {
  return (
    <AbsoluteFill>
      <SiteHeader name="youtube.com" search={query} />
      <div style={{ padding: '26px 120px', display: 'flex', flexDirection: 'column', gap: 22 }}>
        {[0, 1, 2, 3].map((i) => (
          <div key={i} style={{ display: 'flex', gap: 22 }}>
            <div style={block({ width: 300, height: 168, background: i === 0 ? alpha(c.signal, 0.12) : alpha(c.white, 0.06) })} />
            <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 12, paddingTop: 6 }}>
              <div style={block({ height: 22, width: '70%', background: alpha(c.white, i === 0 ? 0.18 : 0.1) })} />
              <div style={block({ height: 14, width: '30%' })} />
              <div style={block({ height: 14, width: '55%' })} />
            </div>
          </div>
        ))}
      </div>
    </AbsoluteFill>
  );
}

/** A watch page: the video, its title and description; sidebar and recommendations removed. */
export function VideoWatch({ progress = 0.3, ended = false }: { progress?: number; ended?: boolean }) {
  return (
    <AbsoluteFill>
      <SiteHeader name="youtube.com" />
      <div style={{ position: 'absolute', left: 40, top: 92, width: 820 }}>
        <div style={{ position: 'relative', height: 461, borderRadius: 14, background: c.black, overflow: 'hidden', border: `1px solid ${alpha(c.white, 0.08)}` }}>
          <div style={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center', fontFamily: fonts.mono, fontSize: 20, color: c.foregroundDim }}>
            {ended ? '' : '▶  rust lifetimes explained'}
          </div>
          {ended ? <Hidden label="End-screen video wall hidden" style={{ inset: 24 }} /> : null}
          <div style={{ position: 'absolute', left: 0, bottom: 0, height: 5, width: `${progress * 100}%`, background: c.danger }} />
        </div>
        <div style={block({ height: 26, width: '75%', marginTop: 18, background: alpha(c.white, 0.16) })} />
        <div style={block({ height: 16, width: '40%', marginTop: 12 })} />
        <div style={block({ height: 70, marginTop: 16 })} />
      </div>
      <Hidden label={'Sidebar & recommendations\nhidden'} style={{ left: 890, right: 40, top: 92, height: 600, whiteSpace: 'pre-line' }} />
    </AbsoluteFill>
  );
}

/** A professional network's messaging open, its feed rule on. */
export function NetworkMessages({ reply }: { reply: string }) {
  return (
    <AbsoluteFill>
      <SiteHeader name="linkedin.com" />
      <Hidden label="Feed hidden by site rule" style={{ left: 40, width: 520, top: 100, bottom: 40 }} />
      <div style={{ position: 'absolute', left: 600, right: 40, top: 100, bottom: 40, borderRadius: 14, border: `1px solid ${alpha(c.white, 0.1)}`, background: c.panel, padding: 26, display: 'flex', flexDirection: 'column', gap: 16 }}>
        <div style={{ fontSize: 18, fontWeight: 700, color: c.foregroundStrong }}>Messaging</div>
        <div style={{ alignSelf: 'flex-start', maxWidth: '78%', padding: '14px 18px', borderRadius: 14, background: alpha(c.white, 0.07), fontSize: 17, color: c.foreground }}>
          Hi — are you free for a quick call about the role this week?
        </div>
        {reply ? (
          <div style={{ alignSelf: 'flex-end', maxWidth: '78%', padding: '14px 18px', borderRadius: 14, background: alpha(c.signal, 0.14), fontSize: 17, color: c.foregroundStrong }}>
            {reply}
          </div>
        ) : null}
      </div>
    </AbsoluteFill>
  );
}
