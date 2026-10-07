/**
 * A terminal session: commands typed, then their output. Output text is what the real tools
 * print — systemd's unit (Restart=always), svcctl's guard message, dpkg's abort — copied from
 * native/linux, not paraphrased.
 */
import React from 'react';
import { AbsoluteFill } from 'remotion';
import { alpha, c, fonts } from '../theme';
import { typed, useTime } from './anim';
import { OsWindow, type Platform } from './Window';

export type TermLine = {
  /** When typing starts (seconds). */
  at: number;
  cmd: string;
  out?: { text: string; tone?: 'plain' | 'danger' | 'ok' | 'dim' }[];
  /** Pause between the command finishing and its output (seconds). */
  delay?: number;
};

const CPS = 24;

export function Terminal({
  lines,
  prompt = 'you@desk:~$',
  platform = 'linux',
  title = 'Terminal',
  width = 1240,
  height = 640,
  offset = { x: 0, y: -40 },
}: {
  lines: TermLine[];
  prompt?: string;
  platform?: Platform;
  title?: string;
  width?: number;
  height?: number;
  offset?: { x: number; y: number };
}) {
  const t = useTime();
  const tone = { plain: c.foreground, danger: c.dangerInk, ok: c.successInk, dim: c.foregroundDim };
  const rows: React.ReactNode[] = [];

  for (const [index, line] of lines.entries()) {
    if (t < line.at) break;
    const shown = typed(line.cmd, t, line.at, CPS);
    const done = shown.length === line.cmd.length;
    const typingEnds = line.at + line.cmd.length / CPS;
    const caret = !done && Math.floor(t * 2.5) % 2 === 0;
    rows.push(
      <div key={`c${index}`}>
        <span style={{ color: c.successInk }}>{prompt}</span> <span style={{ color: c.foregroundStrong }}>{shown}</span>
        {caret ? <span style={{ background: c.foregroundStrong }}> </span> : null}
      </div>,
    );
    if (done && t >= typingEnds + (line.delay ?? 0.5)) {
      for (const [k, out] of (line.out ?? []).entries()) {
        rows.push(
          <div key={`o${index}-${k}`} style={{ color: tone[out.tone ?? 'plain'], whiteSpace: 'pre-wrap' }}>
            {out.text}
          </div>,
        );
      }
    }
  }

  // Keep the newest lines in view, like a real terminal scrolling.
  const visibleRows = rows.slice(-17);

  return (
    <AbsoluteFill style={{ alignItems: 'center', justifyContent: 'center' }}>
      <div style={{ transform: `translate(${offset.x}px, ${offset.y}px)` }}>
        <OsWindow platform={platform} title={title} width={width} height={height}>
          <div
            style={{
              height: '100%',
              padding: '22px 26px',
              background: alpha(c.black, 0.85),
              fontFamily: fonts.mono,
              fontSize: 22,
              lineHeight: 1.55,
              display: 'flex',
              flexDirection: 'column',
            }}
          >
            {visibleRows}
          </div>
        </OsWindow>
      </div>
    </AbsoluteFill>
  );
}
