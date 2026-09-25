/**
 * Everything that turns profiles on and off by itself (spec §3.9):
 *   - recurring blocks: a profile plus a weekly time range (optionally locked, so the key can't
 *     end it — only an emergency unlock can);
 *   - "on at" / "off at" rules that flip a profile's switch at a time of day;
 *   - one-time events on a specific date.
 * Each rule lives on its profile; this page lists them all. The engine (in the service) owns
 * evaluation — the "running" strip reads its snapshot. Anything that could turn blocking *off*
 * sooner (shortening a block, unlocking it, adding an "off") needs the key when that profile is
 * on or scheduled; it then fires later without the key.
 */
import React, { useEffect, useMemo, useState } from 'react';
import type { OnOff, Profile, ScheduleRule, Weekday } from '@talysman/shared';
import { palette, parseHm, windowMinutes } from '@talysman/shared';
import { useFocusStore } from '../store/useFocusStore.js';
import { formatClock, saveProfile } from '../lib/engine.js';
import { Badge, Kicker, ProfileDot, Select } from '../components/ui/index.js';
import { cx } from '../lib/utils.js';
import { isScheduleEnabled } from '../../shared/productLimits.js';

type WindowRule = Extract<ScheduleRule, { kind: 'window' }>;
type AtRule = Extract<ScheduleRule, { kind: 'at' }>;
/** A window together with the profile that owns it. */
type ScheduleWindow = WindowRule & { profileId: string };

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
  return windowMinutes(w.start, w.end);
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


const INPUT =
  'rounded-[7px] border border-white/[0.10] bg-white/[0.04] px-2.5 py-1.5 font-mono text-[12.5px] font-medium text-slate-100 outline-none transition focus:border-white/25';

/** "2026-09-24T18:30" for a datetime-local input, in local time. */
function toLocalInput(ms: number): string {
  const d = new Date(ms);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function DayPicker({ days, onChange }: { days: Weekday[]; onChange: (days: Weekday[]) => void }) {
  return (
    <div className="flex gap-1">
      {DAY_ORDER.map((d) => {
        const has = days.includes(d);
        return (
          <button
            key={d}
            onClick={() => onChange(has ? days.filter((x) => x !== d) : DAY_ORDER.filter((x) => x === d || days.includes(x)))}
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
  );
}

function ProfileChooser({ profiles, value, onChange }: { profiles: Profile[]; value: string; onChange: (id: string) => void }) {
  return (
    <div className="grid grid-cols-2 gap-1.5">
      {profiles.map((p) => {
        const on = value === p.id;
        return (
          <button
            key={p.id}
            onClick={() => onChange(p.id)}
            className={cx(
              'flex items-center gap-1.5 rounded-[7px] border px-2.5 py-1.5 text-left transition',
              on ? 'text-slate-100' : 'border-white/[0.08] bg-white/[0.03] text-slate-400 hover:bg-white/[0.06]',
            )}
            style={on ? { backgroundColor: `${p.color}29`, borderColor: `${p.color}73` } : undefined}
          >
            <ProfileDot color={p.color} size={7} />
            <span className="truncate text-[11.5px] font-medium">{p.name}</span>
          </button>
        );
      })}
    </div>
  );
}

export function SchedulePage({ onUpgrade }: { onUpgrade: () => void }) {
  const profiles = useFocusStore((s) => s.profiles);
  const engine = useFocusStore((s) => s.engine);
  const defaultProfileId = useFocusStore((s) => s.defaultProfileId);
  const productLimits = useFocusStore((s) => s.productLimits);
  const [openId, setOpenId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [newShotAt, setNewShotAt] = useState(() => toLocalInput(Date.now() + 60 * 60 * 1000));
  const [newShotAction, setNewShotAction] = useState<OnOff>('on');
  const [newShotProfile, setNewShotProfile] = useState<string>('');
  // Re-tick so the "now" strip stays honest without waiting for an event.
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    let timer = 0;
    const arm = () => {
      const delay = 60_000 - (Date.now() % 60_000) + 20;
      timer = window.setTimeout(() => {
        setNow(Date.now());
        arm();
      }, delay);
    };
    arm();
    return () => window.clearTimeout(timer);
  }, []);

  const scheduleEnabled = isScheduleEnabled(productLimits);
  const profileFor = (id: string): Profile | undefined => profiles.find((p) => p.id === id);
  const colorFor = (id: string) => profileFor(id)?.color ?? palette.colors.foregroundFaint;
  const nameFor = (id: string) => profileFor(id)?.name ?? 'Profile';

  const windows: ScheduleWindow[] = useMemo(
    () =>
      profiles
        .flatMap((p) =>
          p.config.schedule
            .filter((r): r is WindowRule => r.kind === 'window')
            .map((r) => ({ ...r, profileId: p.id })),
        )
        .sort((a, b) => startMinutes(a) - startMinutes(b)),
    [profiles],
  );
  const atRules = profiles.flatMap((p) =>
    p.config.schedule.filter((r): r is AtRule => r.kind === 'at').map((r) => ({ ...r, profileId: p.id })),
  );
  const oneShots = profiles
    .flatMap((p) => p.config.oneShots.map((e) => ({ ...e, profileId: p.id })))
    .sort((a, b) => a.atMs - b.atMs);

  const weeklyMinutes = windows.reduce((t, w) => t + durationMinutes(w) * w.days.length, 0);
  const running = engine.profiles.find((p) => p.activation.windows.length > 0);
  const runningOcc = running?.activation.windows[0];
  const nextStart = engine.nextEvents.find((e) => e.kind === 'windowStart');
  const today = DAY_ORDER[(new Date(now).getDay() + 6) % 7]!;

  /** Save one profile's schedule/one-shots through the (key-gated) engine. */
  async function saveConfig(profile: Profile, patch: Partial<Profile['config']>) {
    setError(null);
    try {
      await saveProfile({ ...profile, config: { ...profile.config, ...patch } });
    } catch (e) {
      setError((e as Error).message);
    }
  }

  const replaceRule = (profileId: string, id: string, next: ScheduleRule | null) => {
    const profile = profileFor(profileId);
    if (!profile) return;
    const schedule = next
      ? profile.config.schedule.map((r) => (r.id === id ? next : r))
      : profile.config.schedule.filter((r) => r.id !== id);
    return saveConfig(profile, { schedule });
  };

  const patchWindow = (w: ScheduleWindow, fields: Partial<WindowRule>) => {
    const { profileId, ...rule } = w;
    return replaceRule(profileId, w.id, { ...rule, ...fields });
  };

  /** Move a window to another profile: add it there (free), then drop it here (may need the key). */
  async function moveWindow(w: ScheduleWindow, targetId: string) {
    if (targetId === w.profileId) return;
    const target = profileFor(targetId);
    const { profileId, ...rule } = w;
    if (!target) return;
    await saveConfig(target, { schedule: [...target.config.schedule, rule] });
    await replaceRule(profileId, w.id, null);
  }

  function addWindow() {
    if (!scheduleEnabled) return onUpgrade();
    const profile = profileFor(defaultProfileId) ?? profiles[0];
    if (!profile) return;
    const rule: WindowRule = { kind: 'window', id: newId(), days: [...WEEKDAY_SET], start: '09:00', end: '11:00', locked: false };
    setOpenId(rule.id);
    void saveConfig(profile, { schedule: [...profile.config.schedule, rule] });
  }

  function addAtRule(action: OnOff) {
    if (!scheduleEnabled) return onUpgrade();
    const profile = profileFor(defaultProfileId) ?? profiles[0];
    if (!profile) return;
    const rule: AtRule = { kind: 'at', id: newId(), days: [...WEEKDAY_SET], at: action === 'on' ? '09:00' : '17:00', action };
    void saveConfig(profile, { schedule: [...profile.config.schedule, rule] });
  }

  function addOneShot() {
    const profile = profileFor(newShotProfile || defaultProfileId) ?? profiles[0];
    const atMs = new Date(newShotAt).getTime();
    if (!profile || !Number.isFinite(atMs)) return;
    if (atMs <= Date.now()) return setError('Pick a time in the future.');
    void saveConfig(profile, {
      oneShots: [...profile.config.oneShots, { id: newId(), atMs, action: newShotAction, firedAtMs: null }],
    });
  }

  const removeOneShot = (profileId: string, id: string) => {
    const profile = profileFor(profileId);
    if (profile) void saveConfig(profile, { oneShots: profile.config.oneShots.filter((e) => e.id !== id) });
  };

  return (
    <div className="flex h-full min-h-0 flex-col pt-3">
      <div className="flex items-center gap-3">
        <Kicker className="text-[9.5px] tracking-[0.2em]">Recurring blocks · {windows.length}</Kicker>
        <span className="font-mono text-[10px] tracking-[0.1em] text-slate-600">
          {Math.round(weeklyMinutes / 60)}H BLOCKED PER WEEK
        </span>
        {!scheduleEnabled && <Badge tone="neutral">Pro</Badge>}
        <button
          onClick={addWindow}
          className="ml-auto rounded-full border border-seal/30 bg-seal/[0.12] px-3.5 py-1.5 text-[11.5px] font-semibold text-sealInk transition hover:border-seal/45 hover:bg-seal/[0.18]"
        >
          {scheduleEnabled ? '+ New block' : 'Upgrade for scheduling'}
        </button>
      </div>

      <div
        className={cx(
          'mt-3 flex items-center gap-2.5 rounded-[10px] border px-3.5 py-2.5',
          running ? 'border-ok/25 bg-ok/[0.07]' : 'border-white/[0.07] bg-white/[0.025]',
        )}
      >
        <span
          className={cx(
            'block h-2 w-2 shrink-0 rounded-full',
            running ? 'bg-ok shadow-[0_0_9px_2px_rgb(var(--color-success)/0.45)]' : 'bg-slate-450',
          )}
        />
        <span className="text-[12.5px] font-semibold text-slate-150">
          {running ? `${running.profile.name} is running` : 'No block running'}
        </span>
        <span className="ml-auto font-mono text-[10.5px] tracking-[0.06em] text-slate-400">
          {runningOcc
            ? `ENDS ${formatClock(runningOcc.endMs, now).toUpperCase()}`
            : nextStart
              ? `NEXT · ${nameFor(nextStart.profileId).toUpperCase()} AT ${formatClock(nextStart.atMs, now).toUpperCase()}`
              : `${DAY_SHORT[today].toUpperCase()} · NOTHING SCHEDULED`}
        </span>
      </div>

      {error && <p className="mt-2 text-[12px] text-dangerInk">{error}</p>}

      <div className="mt-3 flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto pb-2 pr-1">
        {windows.map((w) => {
          const open = openId === w.id;
          const color = colorFor(w.profileId);
          const isNow = runningOcc?.windowId === w.id && runningOcc.profileId === w.profileId;
          return (
            <div
              key={`${w.profileId}:${w.id}`}
              className={cx(
                'shrink-0 overflow-hidden rounded-xl border transition',
                open
                  ? 'border-white/[0.16] bg-white/[0.05] shadow-[0_10px_26px_rgb(var(--color-black)/0.35)]'
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
                  <span className="font-mono text-[9.5px] tracking-[0.14em] text-slate-450">{durationLabel(w)}</span>
                </span>
                <span className="flex min-w-0 flex-1 flex-col gap-2">
                  <span className="flex items-center gap-2">
                    <ProfileDot color={color} />
                    <span className="truncate text-[13px] font-semibold text-slate-150">{nameFor(w.profileId)}</span>
                    {isNow && (
                      <span className="shrink-0 rounded-full border border-seal/35 bg-seal/[0.13] px-1.5 py-px font-mono text-[9px] font-semibold tracking-[0.14em] text-sealInk">
                        ON NOW
                      </span>
                    )}
                    {w.locked && (
                      <span className="shrink-0 rounded-full border border-locked/30 bg-locked/10 px-1.5 py-px font-mono text-[9px] font-semibold tracking-[0.14em] text-lockedInk">
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
                          style={has ? { backgroundColor: `${color}29`, borderColor: `${color}61` } : undefined}
                        >
                          {DAY_INITIAL[d]}
                        </span>
                      );
                    })}
                    <span className="ml-2 truncate font-mono text-[10.5px] text-slate-450">{daysLabel(w.days)}</span>
                  </span>
                </span>
              </button>

              {open && (
                <div className="grid grid-cols-2 gap-x-4 gap-y-3.5 border-t border-white/[0.06] bg-white/[0.022] px-3.5 pb-3.5 pt-3.5">
                  <div>
                    <Kicker className="text-[9.5px] tracking-[0.16em]">Profile</Kicker>
                    <div className="mt-1.5">
                      <ProfileChooser profiles={profiles} value={w.profileId} onChange={(id) => void moveWindow(w, id)} />
                    </div>
                  </div>
                  <div>
                    <Kicker className="text-[9.5px] tracking-[0.16em]">Time of day</Kicker>
                    <div className="mt-1.5 flex items-center gap-2">
                      <input
                        type="time"
                        aria-label="Start time"
                        value={w.start}
                        onChange={(e) => void patchWindow(w, { start: e.target.value })}
                        className={cx(INPUT, 'w-full')}
                      />
                      <span className="font-mono text-[12px] text-slate-450">→</span>
                      <input
                        type="time"
                        aria-label="End time"
                        value={w.end}
                        onChange={(e) => void patchWindow(w, { end: e.target.value })}
                        className={cx(INPUT, 'w-full')}
                      />
                    </div>
                  </div>
                  <div>
                    <Kicker className="text-[9.5px] tracking-[0.16em]">Repeat weekly</Kicker>
                    <div className="mt-1.5">
                      <DayPicker days={w.days} onChange={(days) => void patchWindow(w, { days })} />
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
                            onClick={() => void patchWindow(w, { days: [...set] })}
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
                      onClick={() => void patchWindow(w, { locked: !w.locked })}
                      className={cx(
                        'flex-1 rounded-lg border py-2.5 text-[11.5px] font-medium transition',
                        w.locked
                          ? 'border-locked/35 bg-locked/[0.14] text-lockedInk'
                          : 'border-white/[0.08] bg-white/[0.03] text-slate-400 hover:bg-white/[0.06]',
                      )}
                    >
                      {w.locked ? 'Locked · key can’t turn it off' : 'Key can turn it off during this block'}
                    </button>
                    <button
                      onClick={() => {
                        setOpenId((cur) => (cur === w.id ? null : cur));
                        void replaceRule(w.profileId, w.id, null);
                      }}
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
          <div className="flex shrink-0 flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-white/[0.10] px-6 py-6 text-center">
            <span className="text-[15px] font-semibold text-slate-250">No blocks yet</span>
            <span className="max-w-sm text-[12px] leading-relaxed text-slate-400">
              A block is a profile plus a time range that repeats every week — like an alarm, but for
              focus. Several profiles can run at once.
            </span>
          </div>
        )}

        {/* "On at" / "Off at" rules. */}
        <div className="mt-3 flex items-center gap-3">
          <Kicker className="text-[9.5px] tracking-[0.2em]">On at / off at · {atRules.length}</Kicker>
          <button onClick={() => addAtRule('on')} className="ml-auto text-[11px] font-medium text-slate-400 hover:text-slate-200">
            + On at…
          </button>
          <button onClick={() => addAtRule('off')} className="text-[11px] font-medium text-slate-400 hover:text-slate-200">
            + Off at…
          </button>
        </div>
        {atRules.map((rule) => {
          const profile = profileFor(rule.profileId);
          const { profileId, ...plain } = rule;
          return (
            <div key={`${profileId}:${rule.id}`} className="flex shrink-0 flex-wrap items-center gap-2 rounded-xl border border-white/[0.06] bg-white/[0.025] px-3.5 py-2.5">
              <Select
                aria-label="Profile"
                value={profileId}
                className="w-40"
                onChange={(e) => {
                  const target = profileFor(e.target.value);
                  if (!target || !profile) return;
                  void saveConfig(target, { schedule: [...target.config.schedule, plain] }).then(() => replaceRule(profileId, rule.id, null));
                }}
              >
                {profiles.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </Select>
              <span className={cx('font-mono text-[11px]', rule.action === 'on' ? 'text-okInk' : 'text-dangerInk')}>
                TURNS {rule.action.toUpperCase()} AT
              </span>
              <input
                type="time"
                aria-label="Time"
                value={rule.at}
                onChange={(e) => void replaceRule(profileId, rule.id, { ...plain, at: e.target.value })}
                className={INPUT}
              />
              <div className="w-56">
                <DayPicker days={rule.days} onChange={(days) => void replaceRule(profileId, rule.id, { ...plain, days })} />
              </div>
              <button
                onClick={() => void replaceRule(profileId, rule.id, null)}
                className="ml-auto text-[11px] text-slate-500 hover:text-dangerInk"
              >
                Remove
              </button>
            </div>
          );
        })}

        {/* One-time events. */}
        <div className="mt-3 flex items-center gap-3">
          <Kicker className="text-[9.5px] tracking-[0.2em]">One-time · {oneShots.length}</Kicker>
        </div>
        <div className="flex shrink-0 flex-wrap items-center gap-2 rounded-xl border border-dashed border-white/[0.10] px-3.5 py-2.5">
          <Select
            aria-label="One-time profile"
            className="w-40"
            value={newShotProfile || defaultProfileId}
            onChange={(e) => setNewShotProfile(e.target.value)}
          >
            {profiles.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </Select>
          <Select aria-label="One-time action" className="w-28" value={newShotAction} onChange={(e) => setNewShotAction(e.target.value as OnOff)}>
            <option value="on">turns on</option>
            <option value="off">turns off</option>
          </Select>
          <input
            type="datetime-local"
            aria-label="One-time date and time"
            value={newShotAt}
            onChange={(e) => setNewShotAt(e.target.value)}
            className={INPUT}
          />
          <button onClick={addOneShot} className="ml-auto text-[11.5px] font-semibold text-slate-300 hover:text-white">
            Add
          </button>
        </div>
        {oneShots.map((shot) => (
          <div key={`${shot.profileId}:${shot.id}`} className="flex shrink-0 items-center gap-2 rounded-xl border border-white/[0.06] bg-white/[0.025] px-3.5 py-2.5">
            <ProfileDot color={colorFor(shot.profileId)} />
            <span className="text-[12.5px] text-slate-200">
              {nameFor(shot.profileId)} turns {shot.action} · {formatClock(shot.atMs, now)}
            </span>
            {shot.firedAtMs !== null ? (
              <Badge tone="ok">DONE</Badge>
            ) : (
              <button onClick={() => removeOneShot(shot.profileId, shot.id)} className="ml-auto text-[11px] text-slate-500 hover:text-dangerInk">
                Remove
              </button>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
