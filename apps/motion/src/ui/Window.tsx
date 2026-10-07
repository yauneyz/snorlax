/**
 * Window chrome per platform. Deliberately plain — the eye should land on what's inside, and the
 * platform should still be recognisable at a glance on the Windows/Mac/Linux pages.
 */
import React from 'react';
import { alpha, c, fonts } from '../theme';

export type Platform = 'windows' | 'mac' | 'linux';

export const TITLEBAR = 40;

export function OsWindow({
  platform,
  title,
  width,
  height,
  children,
  focused = true,
}: {
  platform: Platform;
  title: string;
  width: number;
  /** Content height, excluding the title bar. */
  height: number;
  children: React.ReactNode;
  focused?: boolean;
}) {
  return (
    <div
      style={{
        width,
        height: height + TITLEBAR,
        borderRadius: platform === 'windows' ? 8 : 12,
        overflow: 'hidden',
        background: c.panel,
        border: `1px solid ${alpha(c.white, focused ? 0.12 : 0.07)}`,
        boxShadow: `0 40px 120px ${alpha(c.black, 0.7)}, 0 0 0 1px ${alpha(c.black, 0.6)}`,
        display: 'flex',
        flexDirection: 'column',
      }}
    >
      <TitleBar platform={platform} title={title} />
      <div style={{ position: 'relative', height, overflow: 'hidden' }}>{children}</div>
    </div>
  );
}

function TitleBar({ platform, title }: { platform: Platform; title: string }) {
  const bar: React.CSSProperties = {
    height: TITLEBAR,
    flexShrink: 0,
    display: 'flex',
    alignItems: 'center',
    background: c.panelRaised,
    borderBottom: `1px solid ${alpha(c.white, 0.06)}`,
    fontFamily: fonts.sans,
    fontSize: 14,
    color: c.foregroundSoft,
    position: 'relative',
  };

  if (platform === 'mac') {
    return (
      <div style={{ ...bar, justifyContent: 'center' }}>
        <div style={{ position: 'absolute', left: 16, display: 'flex', gap: 8 }}>
          {[c.danger, c.warning, c.success].map((color) => (
            <span key={color} style={{ width: 13, height: 13, borderRadius: 99, background: color, opacity: 0.85 }} />
          ))}
        </div>
        <span style={{ fontWeight: 600 }}>{title}</span>
      </div>
    );
  }

  if (platform === 'windows') {
    return (
      <div style={{ ...bar, paddingLeft: 16, gap: 10 }}>
        <span>{title}</span>
        <div style={{ marginLeft: 'auto', display: 'flex', height: '100%' }}>
          {['—', '☐', '✕'].map((glyph) => (
            <span key={glyph} style={{ width: 52, display: 'grid', placeItems: 'center', fontSize: glyph === '☐' ? 15 : 13, color: c.foregroundMuted }}>
              {glyph}
            </span>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div style={{ ...bar, justifyContent: 'center' }}>
      <span style={{ fontWeight: 700 }}>{title}</span>
      <span
        style={{
          position: 'absolute',
          right: 12,
          width: 22,
          height: 22,
          borderRadius: 99,
          display: 'grid',
          placeItems: 'center',
          background: alpha(c.white, 0.08),
          fontSize: 11,
          color: c.foregroundSoft,
        }}
      >
        ✕
      </span>
    </div>
  );
}
