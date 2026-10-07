/**
 * "The key is in another room", drawn as a floor plan: your desk, the key where you left it, and
 * the walk between them. This is the whole mechanism — the distance is the lock — so it gets
 * its own scene rather than a caption.
 */
import React from 'react';
import { AbsoluteFill } from 'remotion';
import { alpha, c, fonts } from '../theme';
import { ramp, track, useTime, visible } from './anim';

const W = 1400;
const H = 640;

/** Desk → office door → hall → far door → key. */
const PATH: [number, number][] = [
  [250, 330],
  [470, 470],
  [560, 470],
  [800, 470],
  [880, 300],
  [1180, 210],
];

function pathLength(points: [number, number][]): number {
  let length = 0;
  for (let i = 1; i < points.length; i += 1) {
    length += Math.hypot(points[i]![0] - points[i - 1]![0], points[i]![1] - points[i - 1]![1]);
  }
  return length;
}

function pointAt(points: [number, number][], fraction: number): [number, number] {
  const target = pathLength(points) * Math.min(1, Math.max(0, fraction));
  let walked = 0;
  for (let i = 1; i < points.length; i += 1) {
    const [ax, ay] = points[i - 1]!;
    const [bx, by] = points[i]!;
    const segment = Math.hypot(bx - ax, by - ay);
    if (walked + segment >= target) {
      const k = (target - walked) / segment;
      return [ax + (bx - ax) * k, ay + (by - ay) * k];
    }
    walked += segment;
  }
  return points[points.length - 1]!;
}

/** The path up to `fraction` of its length. */
function partial(points: [number, number][], fraction: number): [number, number][] {
  const total = pathLength(points);
  const out: [number, number][] = [points[0]!];
  for (let i = 1; i < points.length; i += 1) {
    if (pathLength(points.slice(0, i + 1)) <= total * fraction) out.push(points[i]!);
    else break;
  }
  out.push(pointAt(points, fraction));
  return out;
}

export function Room({
  from,
  keyPlace = 'Kitchen counter',
  rooms = ['Desk', 'Hall', 'Kitchen'],
  distance = 'Two rooms away',
  /** 'stay': you look, decide, and go back to work. 'fetch': you walk there, deliberately. */
  outcome = 'stay',
}: {
  from: number;
  keyPlace?: string;
  rooms?: [string, string, string];
  distance?: string;
  outcome?: 'stay' | 'fetch';
}) {
  const t = useTime() - from;
  const drawn = ramp(t, 0.6, 1.6);
  const keyGlow = 0.6 + 0.4 * Math.sin(t * 3);

  // The walker: in 'stay' it leans toward the door and returns to the desk.
  const progress =
    outcome === 'fetch'
      ? track(t, [{ at: 2.4, value: 0 }, { at: 5.2, value: 1 }])
      : track(t, [{ at: 2.4, value: 0 }, { at: 3.2, value: 0.16 }, { at: 3.9, value: 0.16 }, { at: 4.6, value: 0 }]);
  const [wx, wy] = pointAt(PATH, progress);
  const turnBack = outcome === 'stay' ? visible(t, 3.9, 7, 0.3) : 0;

  const wall = { stroke: alpha(c.white, 0.22), strokeWidth: 6, fill: 'none', strokeLinecap: 'round' as const };
  const label = (x: number, y: number, text: string) => (
    <text x={x} y={y} fill={c.foregroundDim} fontFamily={fonts.mono} fontSize={18} letterSpacing="0.16em" textAnchor="middle">
      {text.toUpperCase()}
    </text>
  );

  return (
    <AbsoluteFill style={{ alignItems: 'center', justifyContent: 'center' }}>
      <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} style={{ transform: 'translateY(-40px)' }}>
        <rect x={20} y={40} width={W - 40} height={H - 80} rx={18} fill={alpha(c.white, 0.015)} />
        {/* Outer walls and the two dividing walls, each with a doorway. */}
        <path d={`M20 40 H${W - 20} V${H - 40} H20 Z`} {...wall} />
        <path d="M520 40 V420 M520 520 V600" {...wall} />
        <path d="M840 40 V250 M840 350 V600" {...wall} />
        {label(270, 90, rooms[0])}
        {label(680, 90, rooms[1])}
        {label(1120, 90, rooms[2])}

        {/* Desk with the computer. */}
        <rect x={150} y={250} width={200} height={80} rx={8} fill={alpha(c.white, 0.08)} stroke={alpha(c.white, 0.18)} />
        <rect x={205} y={262} width={90} height={54} rx={5} fill={c.panelRaised} stroke={alpha(c.desktopSignal, 0.6)} />
        <text x={250} y={295} fill={c.desktopSignal} fontFamily={fonts.mono} fontSize={13} textAnchor="middle">
          FOCUSED
        </text>

        {/* Counter with the key. */}
        <rect x={1050} y={150} width={300} height={110} rx={8} fill={alpha(c.white, 0.06)} stroke={alpha(c.white, 0.16)} />
        <g transform="translate(1180 210)">
          <circle r={40} fill={alpha(c.signal, 0.12 * keyGlow)} />
          <rect x={-28} y={-12} width={40} height={24} rx={5} fill={c.brand} />
          <rect x={12} y={-8} width={18} height={16} rx={2} fill={c.foregroundMuted} />
        </g>
        <text x={1200} y={300} fill={c.signal} fontFamily={fonts.sans} fontSize={22} fontWeight={600} textAnchor="middle">
          {keyPlace}
        </text>

        {/* The walk. */}
        <polyline
          points={partial(PATH, drawn)
            .map((p) => p.join(','))
            .join(' ')}
          fill="none"
          stroke={alpha(c.signal, 0.75)}
          strokeWidth={4}
          strokeDasharray="2 14"
          strokeLinecap="round"
        />
        <text
          x={680}
          y={520}
          fill={c.foregroundStrong}
          fontFamily={fonts.sans}
          fontSize={26}
          fontWeight={600}
          textAnchor="middle"
          opacity={ramp(t, 1.6, 0.5)}
        >
          {distance}
        </text>

        {/* You. */}
        <g transform={`translate(${wx} ${wy})`}>
          <circle r={22} fill={c.foregroundStrong} />
          <circle r={34} fill="none" stroke={alpha(c.white, 0.25)} strokeWidth={2} />
        </g>
        <text x={250} y={390} fill={c.foregroundStrong} fontFamily={fonts.sans} fontSize={20} textAnchor="middle" opacity={1 - ramp(t, 2.2, 0.3) + turnBack}>
          {turnBack > 0 ? 'Not worth the walk' : 'You'}
        </text>
      </svg>
    </AbsoluteFill>
  );
}
