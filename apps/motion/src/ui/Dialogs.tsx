/**
 * Operating-system surfaces the workaround attempts land on. Message text is the shipping text:
 * the uninstall refusal is native/windows/installer/nsis-include.nsh word for word, and the
 * process names are native/windows/src/constants.rs.
 */
import React from 'react';
import { AbsoluteFill } from 'remotion';
import { alpha, c, fonts } from '../theme';
import { ramp, useTime } from './anim';
import { OsWindow } from './Window';

/** NSIS `customUnInstall` guard, as shown by the Windows uninstaller. */
export const UNINSTALL_REFUSAL = [
  'Talysman is currently enforcing focus and no paired USB key is present.',
  'Insert your key, then uninstall again.',
];

export function MessageBox({ title, lines, from }: { title: string; lines: string[]; from: number }) {
  const t = useTime();
  const pop = ramp(t, from, 0.25);
  if (t < from) return null;
  return (
    <AbsoluteFill style={{ alignItems: 'center', justifyContent: 'center' }}>
      <div style={{ transform: `translateY(-40px) scale(${0.96 + 0.04 * pop})`, opacity: pop }}>
        <OsWindow platform="windows" title={title} width={640} height={230}>
          <div style={{ height: '100%', display: 'flex', flexDirection: 'column', background: c.panelRaised, fontFamily: fonts.sans }}>
            <div style={{ flex: 1, display: 'flex', gap: 22, padding: '28px 30px' }}>
              <span
                style={{
                  flexShrink: 0,
                  width: 44,
                  height: 44,
                  borderRadius: 99,
                  background: c.danger,
                  color: c.white,
                  display: 'grid',
                  placeItems: 'center',
                  fontSize: 26,
                  fontWeight: 700,
                }}
              >
                ✕
              </span>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 14, fontSize: 19, color: c.foregroundStrong, lineHeight: 1.4 }}>
                {lines.map((line) => (
                  <span key={line}>{line}</span>
                ))}
              </div>
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', padding: '14px 20px', background: c.panel }}>
              <span style={{ padding: '7px 34px', borderRadius: 5, border: `2px solid ${c.desktopSignal}`, fontSize: 16, color: c.foregroundStrong }}>OK</span>
            </div>
          </div>
        </OsWindow>
      </div>
    </AbsoluteFill>
  );
}

/**
 * Task Manager's process list. The app (Talysman) can be ended like any app; the enforcement
 * service runs separately as a Windows service and keeps going.
 */
export function TaskManager({ endAt, selectAt }: { endAt: number; selectAt: number }) {
  const t = useTime();
  const appGone = t >= endAt;
  const rows: { name: string; kind: string; status: string; selected?: boolean; hidden?: boolean; highlight?: boolean }[] = [
    { name: 'Code', kind: 'App', status: '' },
    { name: 'Google Chrome', kind: 'App', status: '' },
    { name: 'Talysman', kind: 'App', status: '', selected: t >= selectAt && !appGone, hidden: appGone },
    { name: 'Talysman Enforcement Service (TalysmanSvc)', kind: 'Background service', status: 'Running', highlight: appGone },
    { name: 'Windows Explorer', kind: 'Windows process', status: '' },
  ];
  const pulse = appGone ? 0.5 + 0.5 * Math.sin((t - endAt) * 5) : 0;

  return (
    <AbsoluteFill style={{ alignItems: 'center', justifyContent: 'center' }}>
      <div style={{ transform: 'translateY(-40px)' }}>
        <OsWindow platform="windows" title="Task Manager" width={1100} height={470}>
          <div style={{ height: '100%', background: c.panel, fontFamily: fonts.sans, color: c.foreground }}>
            <div style={{ display: 'flex', alignItems: 'center', padding: '18px 26px', borderBottom: `1px solid ${alpha(c.white, 0.06)}` }}>
              <span style={{ fontSize: 22, fontWeight: 600, color: c.foregroundStrong }}>Processes</span>
              <span
                style={{
                  marginLeft: 'auto',
                  padding: '8px 18px',
                  borderRadius: 6,
                  fontSize: 16,
                  background: t >= selectAt && !appGone ? alpha(c.white, 0.1) : 'transparent',
                  color: t >= selectAt && !appGone ? c.foregroundStrong : c.foregroundDim,
                  border: `1px solid ${alpha(c.white, 0.12)}`,
                }}
              >
                End task
              </span>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 240px 140px', padding: '10px 26px', fontSize: 15, color: c.foregroundDim }}>
              <span>Name</span>
              <span>Type</span>
              <span>Status</span>
            </div>
            {rows
              .filter((row) => !row.hidden)
              .map((row) => (
                <div
                  key={row.name}
                  style={{
                    display: 'grid',
                    gridTemplateColumns: '1fr 240px 140px',
                    padding: '15px 26px',
                    fontSize: 18,
                    background: row.selected
                      ? alpha(c.desktopSignal, 0.14)
                      : row.highlight
                        ? alpha(c.success, 0.06 + 0.08 * pulse)
                        : 'transparent',
                    borderTop: `1px solid ${alpha(c.white, 0.04)}`,
                  }}
                >
                  <span style={{ color: c.foregroundStrong }}>{row.name}</span>
                  <span style={{ color: c.foregroundMuted }}>{row.kind}</span>
                  <span style={{ color: row.status ? c.successInk : c.foregroundDim }}>{row.status}</span>
                </div>
              ))}
          </div>
        </OsWindow>
      </div>
    </AbsoluteFill>
  );
}

/** A restart, compressed: the screen goes dark and Windows comes back. */
export function Restart({ from, to }: { from: number; to: number }) {
  const t = useTime();
  if (t < from || t > to) return null;
  const mid = (from + to) / 2;
  const spin = (t - from) * 360;
  return (
    <AbsoluteFill style={{ background: c.black, alignItems: 'center', justifyContent: 'center', opacity: Math.min(ramp(t, from, 0.3), 1 - ramp(t, to - 0.3, 0.3)) }}>
      <svg width="64" height="64" viewBox="0 0 64 64" style={{ transform: `rotate(${spin}deg)` }}>
        <circle cx="32" cy="32" r="24" fill="none" stroke={alpha(c.white, 0.15)} strokeWidth="5" />
        <path d="M32 8 A24 24 0 0 1 56 32" fill="none" stroke={c.white} strokeWidth="5" strokeLinecap="round" />
      </svg>
      <span style={{ marginTop: 26, fontFamily: fonts.sans, fontSize: 24, color: c.foregroundSoft }}>{t < mid ? 'Restarting' : 'Welcome'}</span>
    </AbsoluteFill>
  );
}
