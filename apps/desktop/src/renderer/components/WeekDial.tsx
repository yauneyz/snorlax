/**
 * The week dial: seven concentric rings, outermost = Monday, each one a 24-hour clock with
 * 00:00 at the top. Every ring is painted from the *real* schedule using the same coverage
 * rule the engine uses, so what you see is what the service will enforce.
 */
import React from 'react';
import type { Profile, Schedule, ScheduleWindow, Weekday } from '@talysman/shared';
import { windowCovers } from '@talysman/core/schedule';

const BOX = 380;
const OUT = 344; // outer ring diameter
const THICK = 17; // ring band thickness
const STEP = 21; // radius step between days
const CX = BOX / 2;
/** 15-minute resolution — fine enough that a :15 boundary lands on the right pixel. */
const SAMPLES = 96;
const DEG = 360 / SAMPLES;
const BASE = 'rgba(255,255,255,0.045)';

const DAYS: Weekday[] = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];
const LETTERS = ['M', 'T', 'W', 'T', 'F', 'S', 'S'];

export interface DialSlice {
  profile: Profile | undefined;
  /** Hours per week this profile is scheduled for. */
  hours: number;
}

/** Which window governs a given minute — first covering window, but a locked one wins. */
function windowAt(windows: ScheduleWindow[], day: Weekday, minute: number): ScheduleWindow | null {
  let hit: ScheduleWindow | null = null;
  for (const w of windows) {
    if (!windowCovers(w, day, minute)) continue;
    if (!hit) hit = w;
    if (w.locked && !hit.locked) hit = w;
  }
  return hit;
}

function ringGradient(
  windows: ScheduleWindow[],
  day: Weekday,
  colorOf: (w: ScheduleWindow) => string,
): string {
  const stops: string[] = [];
  let runColor: string | null = null;
  let runStart = 0;
  const flush = (end: number) => {
    stops.push(`${runColor ?? BASE} ${runStart * DEG}deg ${end * DEG}deg`);
  };
  for (let i = 0; i < SAMPLES; i++) {
    const w = windowAt(windows, day, Math.round(i * (1440 / SAMPLES)));
    const color = w ? colorOf(w) : null;
    if (i === 0) {
      runColor = color;
    } else if (color !== runColor) {
      flush(i);
      runColor = color;
      runStart = i;
    }
  }
  flush(SAMPLES);
  return `conic-gradient(${stops.join(',')})`;
}

/** Scheduled hours per week, per profile — drives the legend beside the dial. */
export function dialLegend(
  schedule: Schedule,
  profiles: Profile[],
  activeProfileId: string,
): { slices: DialSlice[]; lockedHours: number; unscheduledHours: number } {
  const hoursPerSample = 24 / SAMPLES;
  const byProfile = new Map<string, number>();
  let lockedHours = 0;
  let covered = 0;
  for (const day of DAYS) {
    for (let i = 0; i < SAMPLES; i++) {
      const w = windowAt(schedule.windows, day, Math.round(i * (1440 / SAMPLES)));
      if (!w) continue;
      covered += hoursPerSample;
      if (w.locked) lockedHours += hoursPerSample;
      const id = w.profileId ?? activeProfileId;
      byProfile.set(id, (byProfile.get(id) ?? 0) + hoursPerSample);
    }
  }
  const slices = [...byProfile.entries()]
    .map(([id, hours]) => ({ profile: profiles.find((p) => p.id === id), hours }))
    .sort((a, b) => b.hours - a.hours);
  return { slices, lockedHours, unscheduledHours: 24 * 7 - covered };
}

export function WeekDial({
  schedule,
  profiles,
  activeProfileId,
  now = new Date(),
}: {
  schedule: Schedule;
  profiles: Profile[];
  activeProfileId: string;
  now?: Date;
}) {
  const colorOf = (w: ScheduleWindow) =>
    profiles.find((p) => p.id === (w.profileId ?? activeProfileId))?.color ?? '#4fd6c0';

  const innerHole = (OUT - 6 * STEP * 2) / 2 - THICK;
  // JS weeks start on Sunday; the dial starts on Monday.
  const nowDay = (now.getDay() + 6) % 7;
  const nowHour = now.getHours() + now.getMinutes() / 60;
  const nowAngle = nowHour * 15;
  const nowRadius = (OUT - nowDay * STEP * 2) / 2 - THICK / 2;
  const nowRad = ((nowAngle - 90) * Math.PI) / 180;

  return (
    <div className="relative" style={{ width: BOX, height: BOX }}>
      <div className="absolute inset-[18px] rounded-full bg-[radial-gradient(circle,rgba(79,214,192,0.05),transparent_70%)]" />

      {DAYS.map((day, i) => {
        const size = OUT - i * STEP * 2;
        const radius = size / 2;
        const mask = `radial-gradient(circle, transparent ${radius - THICK}px, #000 ${
          radius - THICK + 0.5
        }px)`;
        return (
          <div
            key={day}
            className="absolute rounded-full"
            style={{
              left: (BOX - size) / 2,
              top: (BOX - size) / 2,
              width: size,
              height: size,
              background: ringGradient(schedule.windows, day, colorOf),
              WebkitMaskImage: mask,
              maskImage: mask,
            }}
          />
        );
      })}

      {LETTERS.map((letter, i) => (
        <span
          key={i}
          className={`absolute w-5 text-right font-mono text-[9.5px] font-medium ${
            i === nowDay ? 'text-sealInk' : 'text-slate-600'
          }`}
          style={{ left: 0, top: (BOX - (OUT - i * STEP * 2)) / 2 + THICK / 2 - 6 }}
        >
          {letter}
        </span>
      ))}

      {[0, 3, 6, 9, 12, 15, 18, 21].map((h) => (
        <span
          key={h}
          aria-hidden
          className="absolute block w-px origin-[50%_0]"
          style={{
            left: CX,
            top: CX,
            height: OUT / 2,
            transform: `translate(-50%,0) rotate(${180 + h * 15}deg)`,
            background: `linear-gradient(to bottom, transparent 0, transparent ${innerHole}px, ${
              h % 6 === 0 ? 'rgba(255,255,255,0.16)' : 'rgba(255,255,255,0.07)'
            } ${innerHole}px)`,
          }}
        />
      ))}

      {/* The now hand, plus a bead on the ring for today. */}
      <span
        aria-hidden
        className="absolute block w-px origin-[50%_0]"
        style={{
          left: CX,
          top: CX,
          height: OUT / 2,
          transform: `translate(-50%,0) rotate(${180 + nowAngle}deg)`,
          background:
            'linear-gradient(to bottom, rgba(242,243,245,0) 30px, rgba(242,243,245,0.85) 100%)',
          boxShadow: '0 0 8px rgba(242,243,245,0.5)',
        }}
      />
      <span
        aria-hidden
        className="absolute block h-[9px] w-[9px] rounded-full bg-slate-100 shadow-[0_0_12px_3px_rgba(242,243,245,0.6)]"
        style={{
          left: CX + Math.cos(nowRad) * nowRadius - 4.5,
          top: CX + Math.sin(nowRad) * nowRadius - 4.5,
        }}
      />

      <div
        className="absolute flex items-center justify-center rounded-full border border-white/[0.08] bg-[radial-gradient(circle,rgba(79,214,192,0.12),transparent_72%)]"
        style={{
          left: CX - (innerHole + 4),
          top: CX - (innerHole + 4),
          width: (innerHole + 4) * 2,
          height: (innerHole + 4) * 2,
        }}
      >
        <span className="block h-2.5 w-2.5 rotate-45 rounded-[3px] border-[1.5px] border-sealInk shadow-[0_0_10px_rgba(79,214,192,0.5)]" />
      </div>
    </div>
  );
}
