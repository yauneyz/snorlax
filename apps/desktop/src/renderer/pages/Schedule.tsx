/**
 * Recurring blocks — a profile plus a time range that repeats every week. Each block is a card;
 * pressing one opens its editor inline. Every edit writes the whole window list back through the
 * service, which owns evaluation (we only mirror it here to label what's running right now).
 */
import React, { useEffect, useMemo, useState } from 'react';
import type { Profile, ScheduleWindow, Weekday } from '@talysman/shared';
import { resolveActiveProfile } from '@talysman/shared';
import { evaluateSchedule, parseHm, windowCovers } from '@talysman/core/schedule';
import { request } from '../lib/bridge.js';
import { useFocusStore } from '../store/useFocusStore.js';
import { Badge, Kicker, ProfileDot } from '../components/ui/index.js';
import { cx } from '../lib/utils.js';
import { isScheduleEnabled } from '../../shared/productLimits.js';

/** Sentinel for "don't switch profiles" — a window with no `profileId`. */
const KEEP_ACTIVE = '';

/** Monday-first for display; `WEEKDAYS` from shared is Sunday-first to match `Date.getDay()`. */
const DAY_ORDER: Weekday[] = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];
const DAY_INITIAL: Record<Weekday, string> = {
  mon: 'M',
  tue: 'T',
  wed: 'W',
  thu: 'T',
  fri: 'F',
  sat: 'S',
  sun: 'S',
};
const DAY_SHORT: Record<Weekday, string> = {
  mon: 'Mon',
  tue: 'Tue',
  wed: 'Wed',
  thu: 'Thu',
  fri: 'Fri',
  sat: 'Sat',
  sun: 'Sun',
};
const WEEKDAY_SET: Weekday[] = ['mon', 'tue', 'wed', 'thu', 'fri'];
const WEEKEND_SET: Weekday[] = ['sat', 'sun'];

let idCounter = 0;
const newId = () => `win-${Date.now()}-${idCounter++}`;

const sameDays = (a: Weekday[], b: Weekday[]) =>
  a.length === b.length && DAY_ORDER.filter((d) => a.includes(d)).join() === b.join();

/** "HH:MM" → "9:00 AM". Falls back to the raw string if the service ever hands us junk. */
function fmt12(hm: string): string {
  const mins = parseHm(hm);
  if (mins === null) return hm;
  const h24 = Math.floor(mins / 60);
  const suffix = h24 >= 12 ? 'PM' : 'AM';
  const h12 = h24 % 12 === 0 ? 12 : h24 % 12;
  return `${h12}:${String(mins % 60).padStart(2, '0')} ${suffix}`;
}

/** Length of a window in minutes; windows whose end wraps past midnight run into the next day. */
function durationMinutes(w: ScheduleWindow): number {
  const start = parseHm(w.start);
  const end = parseHm(w.end);
  if (start === null || end === null || start === end) return 0;
  return end > start ? end - start : 24 * 60 - start + end;
}

function durationLabel(w: ScheduleWindow): string {
  const total = durationMinutes(w);
  const h = Math.floor(total / 60);
  const m = total % 60;
  return m ? `${h}H ${m}M` : `${h}H`;
}

function daysLabel(days: Weekday[]): string {
  if (days.length === 0) return 'Never';
  if (days.length === 7) return 'Every day';
  if (sameDays(days, WEEKDAY_SET)) return 'Weekdays';
  if (sameDays(days, WEEKEND_SET)) return 'Weekend';
  return DAY_ORDER.filter((d) => days.includes(d))
    .map((d) => DAY_SHORT[d])
    .join(' ');
}

const startMinutes = (w: ScheduleWindow) => parseHm(w.start) ?? 0;

export function SchedulePage({ onUpgrade }: { onUpgrade: () => void }) {
  const schedule = useFocusStore((s) => s.schedule);
  const profiles = useFocusStore((s) => s.profiles);
  const activeProfileId = useFocusStore((s) => s.activeProfileId);
  const productLimits = useFocusStore((s) => s.productLimits);
  const refresh = useFocusStore((s) => s.refresh);
  const [openId, setOpenId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Re-tick so the "now" strip stays honest without waiting for a scheduleFired event.
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 30_000);
    return () => clearInterval(t);
  }, []);

  const scheduleEnabled = isScheduleEnabled(productLimits);
  const activeProfile = resolveActiveProfile(profiles, activeProfileId);
  const profileFor = (id: string | undefined): Profile | undefined =>
    id ? profiles.find((p) => p.id === id) : undefined;
  /** The colour a window paints with — its own profile, or whatever is active if it keeps it. */
  const colorFor = (w: ScheduleWindow) =>
    profileFor(w.profileId)?.color ?? activeProfile?.color ?? '#5a5f67';
  const nameFor = (w: ScheduleWindow) => profileFor(w.profileId)?.name ?? 'Active profile';

  const windows = useMemo(
    () => [...schedule.windows].sort((a, b) => startMinutes(a) - startMinutes(b)),
    [schedule.windows],
  );

  const weeklyMinutes = windows.reduce((t, w) => t + durationMinutes(w) * w.days.length, 0);
  const evaluation = evaluateSchedule(schedule, now);
  const runningWindow = windows.find((w) => w.id === evaluation.windowId);
  const today = DAY_ORDER[(now.getDay() + 6) % 7]!;
  const minuteOfDay = now.getHours() * 60 + now.getMinutes();
  const nextWindow = windows.find(
    (w) => w.days.includes(today) && startMinutes(w) > minuteOfDay && !windowCovers(w, today, minuteOfDay),
  );
  const clock = fmt12(
    `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`,
  );

  async function save(next: ScheduleWindow[]) {
    setError(null);
    try {
      await request('setSchedule', { schedule: { windows: next } });
      await refresh();
    } catch (e) {
      setError((e as Error).message);
    }
  }

  const patch = (id: string, fields: Partial<ScheduleWindow>) =>
    save(schedule.windows.map((w) => (w.id === id ? { ...w, ...fields } : w)));

  function addWindow() {
    if (!scheduleEnabled) return onUpgrade();
    const w: ScheduleWindow = {
      id: newId(),
      days: [...WEEKDAY_SET],
      start: '09:00',
      end: '11:00',
      locked: false,
    };
    setOpenId(w.id);
    void save([...schedule.windows, w]);
  }

  const removeWindow = (id: string) => {
    setOpenId((cur) => (cur === id ? null : cur));
    void save(schedule.windows.filter((w) => w.id !== id));
  };

  const setProfile = (w: ScheduleWindow, profileId: string) =>
    patch(w.id, profileId ? { profileId } : { profileId: undefined });

  const toggleDay = (w: ScheduleWindow, day: Weekday) =>
    patch(w.id, {
      days: w.days.includes(day)
        ? w.days.filter((d) => d !== day)
        : DAY_ORDER.filter((d) => d === day || w.days.includes(d)),
    });

  return (
    <div className="flex h-full min-h-0 flex-col pt-3">
      <div className="flex items-center gap-3">
        <Kicker className="text-[9.5px] tracking-[0.2em]">
          Recurring blocks · {windows.length}
        </Kicker>
        <span className="font-mono text-[10px] tracking-[0.1em] text-slate-600">
          {Math.round(weeklyMinutes / 60)}H BLOCKED PER WEEK
        </span>
        {!scheduleEnabled && <Badge tone="neutral">Pro</Badge>}
        <button
          onClick={addWindow}
          className="ml-auto rounded-lg border border-seal/30 bg-seal/[0.12] px-3.5 py-1.5 text-[11.5px] font-semibold text-sealInk transition hover:border-seal/45 hover:bg-seal/[0.18]"
        >
          {scheduleEnabled ? '+ New block' : 'Upgrade for scheduling'}
        </button>
      </div>

      <div
        className={cx(
          'mt-3 flex items-center gap-2.5 rounded-[10px] border px-3.5 py-2.5',
          runningWindow ? 'border-seal/25 bg-seal/[0.07]' : 'border-white/[0.07] bg-white/[0.025]',
        )}
      >
        <span
          className={cx(
            'block h-2 w-2 shrink-0 rounded-full',
            runningWindow
              ? 'animate-pulse bg-seal shadow-[0_0_9px_2px_rgba(79,214,192,0.45)]'
              : 'bg-slate-450',
          )}
        />
        <span className="text-[12.5px] font-semibold text-slate-150">
          {runningWindow ? `${nameFor(runningWindow)} is running` : 'No block running'}
        </span>
        <span className="ml-auto font-mono text-[10.5px] tracking-[0.06em] text-slate-400">
          {runningWindow
            ? `ENDS ${fmt12(runningWindow.end)} · ${DAY_SHORT[today].toUpperCase()} ${clock}`
            : nextWindow
              ? `NEXT · ${nameFor(nextWindow).toUpperCase()} AT ${fmt12(nextWindow.start)}`
              : `${DAY_SHORT[today].toUpperCase()} ${clock} · NOTHING LEFT TODAY`}
        </span>
      </div>

      {error && <p className="mt-2 text-[12px] text-dangerInk">{error}</p>}

      <div className="mt-3 flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto pb-2 pr-1">
        {windows.map((w) => {
          const open = openId === w.id;
          const color = colorFor(w);
          const isNow = runningWindow?.id === w.id;
          return (
            <div
              key={w.id}
              className={cx(
                'shrink-0 overflow-hidden rounded-xl border transition',
                open
                  ? 'border-white/[0.16] bg-white/[0.05] shadow-[0_10px_26px_rgba(0,0,0,0.35)]'
                  : 'border-white/[0.06] bg-white/[0.025] hover:border-white/[0.10]',
              )}
            >
              <button
                onClick={() => setOpenId(open ? null : w.id)}
                aria-expanded={open}
                className="flex w-full items-center gap-[18px] px-3.5 py-3 text-left"
              >
                <span className="flex w-[250px] shrink-0 flex-col gap-[3px]">
                  <span className="whitespace-nowrap font-mono text-[20px] font-medium tracking-[-0.02em] text-slate-100">
                    {fmt12(w.start)} → {fmt12(w.end)}
                  </span>
                  <span className="font-mono text-[9.5px] tracking-[0.14em] text-slate-450">
                    {durationLabel(w)}
                  </span>
                </span>

                <span className="flex min-w-0 flex-1 flex-col gap-2">
                  <span className="flex items-center gap-2">
                    <ProfileDot color={color} />
                    <span className="truncate text-[13px] font-semibold text-slate-150">
                      {nameFor(w)}
                    </span>
                    {isNow && (
                      <span className="shrink-0 rounded-full border border-seal/35 bg-seal/[0.13] px-1.5 py-px font-mono text-[9px] font-semibold tracking-[0.14em] text-sealInk">
                        ON NOW
                      </span>
                    )}
                    {w.locked && (
                      <span className="shrink-0 rounded-full border border-[#ff8f6b]/30 bg-[#ff8f6b]/10 px-1.5 py-px font-mono text-[9px] font-semibold tracking-[0.14em] text-[#ffb59d]">
                        KEY LOCKED
                      </span>
                    )}
                  </span>
                  <span className="flex items-center gap-1">
                    {DAY_ORDER.map((d) => {
                      const has = w.days.includes(d);
                      return (
                        <span
                          key={d}
                          className={cx(
                            'flex h-5 w-[23px] items-center justify-center rounded-[5px] border font-mono text-[9.5px] font-semibold',
                            has ? 'text-slate-100' : 'border-white/[0.06] bg-white/[0.03] text-slate-600',
                          )}
                          style={
                            has
                              ? { backgroundColor: `${color}29`, borderColor: `${color}61` }
                              : undefined
                          }
                        >
                          {DAY_INITIAL[d]}
                        </span>
                      );
                    })}
                    <span className="ml-2 truncate font-mono text-[10.5px] text-slate-450">
                      {daysLabel(w.days)}
                    </span>
                  </span>
                </span>
              </button>

              {open && (
                <div className="grid grid-cols-2 gap-x-4 gap-y-3.5 border-t border-white/[0.06] bg-white/[0.022] px-3.5 pb-3.5 pt-3.5">
                  <div>
                    <Kicker className="text-[9.5px] tracking-[0.16em]">Profile</Kicker>
                    <div className="mt-1.5 grid grid-cols-2 gap-1.5">
                      {[{ id: KEEP_ACTIVE, name: 'Keep active', color: '#5a5f67' }, ...profiles].map(
                        (p) => {
                          const on = (w.profileId ?? KEEP_ACTIVE) === p.id;
                          return (
                            <button
                              key={p.id || 'keep-active'}
                              onClick={() => setProfile(w, p.id)}
                              className={cx(
                                'flex items-center gap-1.5 rounded-[7px] border px-2.5 py-1.5 text-left transition',
                                on
                                  ? 'text-slate-100'
                                  : 'border-white/[0.08] bg-white/[0.03] text-slate-400 hover:bg-white/[0.06]',
                              )}
                              style={
                                on
                                  ? { backgroundColor: `${p.color}29`, borderColor: `${p.color}73` }
                                  : undefined
                              }
                            >
                              <ProfileDot color={p.color} size={7} />
                              <span className="truncate text-[11.5px] font-medium">{p.name}</span>
                            </button>
                          );
                        },
                      )}
                    </div>
                  </div>

                  <div>
                    <Kicker className="text-[9.5px] tracking-[0.16em]">Time of day</Kicker>
                    <div className="mt-1.5 flex items-center gap-2">
                      <input
                        type="time"
                        aria-label="Start time"
                        value={w.start}
                        onChange={(e) => patch(w.id, { start: e.target.value })}
                        className="w-full rounded-[7px] border border-white/[0.10] bg-white/[0.04] px-2.5 py-1.5 font-mono text-[12.5px] font-medium text-slate-100 outline-none transition focus:border-white/25"
                      />
                      <span className="font-mono text-[12px] text-slate-450">→</span>
                      <input
                        type="time"
                        aria-label="End time"
                        value={w.end}
                        onChange={(e) => patch(w.id, { end: e.target.value })}
                        className="w-full rounded-[7px] border border-white/[0.10] bg-white/[0.04] px-2.5 py-1.5 font-mono text-[12.5px] font-medium text-slate-100 outline-none transition focus:border-white/25"
                      />
                    </div>
                  </div>

                  <div>
                    <Kicker className="text-[9.5px] tracking-[0.16em]">Repeat weekly</Kicker>
                    <div className="mt-1.5 flex gap-1">
                      {DAY_ORDER.map((d) => {
                        const has = w.days.includes(d);
                        return (
                          <button
                            key={d}
                            onClick={() => toggleDay(w, d)}
                            aria-label={DAY_SHORT[d]}
                            aria-pressed={has}
                            className={cx(
                              'flex-1 rounded-md border py-1.5 font-mono text-[11px] font-semibold transition',
                              has
                                ? 'border-seal/40 bg-seal/[0.16] text-sealInk'
                                : 'border-white/[0.08] bg-white/[0.03] text-slate-500 hover:bg-white/[0.06]',
                            )}
                          >
                            {DAY_INITIAL[d]}
                          </button>
                        );
                      })}
                    </div>
                    <div className="mt-1.5 flex gap-1.5">
                      {(
                        [
                          ['Weekdays', WEEKDAY_SET],
                          ['Weekend', WEEKEND_SET],
                          ['Every day', DAY_ORDER],
                        ] as const
                      ).map(([label, set]) => {
                        const on = sameDays(w.days, set);
                        return (
                          <button
                            key={label}
                            onClick={() => patch(w.id, { days: [...set] })}
                            className={cx(
                              'rounded-full border px-2.5 py-1 text-[10.5px] font-medium transition',
                              on
                                ? 'border-white/[0.18] bg-white/[0.08] text-slate-150'
                                : 'border-white/[0.08] bg-transparent text-slate-400 hover:bg-white/[0.05]',
                            )}
                          >
                            {label}
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  <div className="flex items-end gap-2">
                    <button
                      onClick={() => patch(w.id, { locked: !w.locked })}
                      className={cx(
                        'flex-1 rounded-lg border py-2.5 text-[11.5px] font-medium transition',
                        w.locked
                          ? 'border-[#ff8f6b]/35 bg-[#ff8f6b]/[0.14] text-[#ffb59d]'
                          : 'border-white/[0.08] bg-white/[0.03] text-slate-400 hover:bg-white/[0.06]',
                      )}
                    >
                      {w.locked ? 'Locked · key can’t disable' : 'Key can disable during this block'}
                    </button>
                    <button
                      onClick={() => removeWindow(w.id)}
                      className="rounded-lg border border-danger/28 px-3.5 py-2.5 text-[11.5px] font-medium text-dangerInk transition hover:bg-danger/[0.10]"
                    >
                      Delete
                    </button>
                  </div>
                </div>
              )}
            </div>
          );
        })}

        {windows.length === 0 && (
          <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-white/[0.10] px-6 py-8 text-center">
            <span className="text-[15px] font-semibold text-slate-250">No blocks yet</span>
            <span className="max-w-sm text-[12px] leading-relaxed text-slate-400">
              A block is a profile plus a time range that repeats every week — like an alarm, but
              for focus. Until you add one, focus stays on whichever profile you picked by hand.
            </span>
            <button
              onClick={addWindow}
              className="mt-1.5 rounded-[9px] border border-seal/30 bg-seal/[0.12] px-[18px] py-2 text-[12.5px] font-semibold text-sealInk transition hover:border-seal/45 hover:bg-seal/[0.18]"
            >
              {scheduleEnabled ? 'Add your first block' : 'Upgrade for scheduling'}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
