import React, { useState } from 'react';
import type { ScheduleWindow, Weekday } from '@talysman/shared';
import { WEEKDAYS, resolveActiveProfile } from '@talysman/shared';
import { request } from '../lib/bridge.js';
import { useFocusStore } from '../store/useFocusStore.js';
import { Badge, Button, Input, Kicker, ProfileDot, Select } from '../components/ui/index.js';
import { WeekDial, dialLegend } from '../components/WeekDial.js';
import { cx } from '../lib/utils.js';
import { isScheduleEnabled } from '../../shared/productLimits.js';

/** Sentinel for "don't switch profiles" — a window with no `profileId`. */
const KEEP_ACTIVE = '';

let idCounter = 0;
const newId = () => `win-${Date.now()}-${idCounter++}`;

const hours = (h: number) => `${h < 10 ? h.toFixed(1) : Math.round(h)}h`;

export function SchedulePage({ onUpgrade }: { onUpgrade: () => void }) {
  const schedule = useFocusStore((s) => s.schedule);
  const profiles = useFocusStore((s) => s.profiles);
  const activeProfileId = useFocusStore((s) => s.activeProfileId);
  const productLimits = useFocusStore((s) => s.productLimits);
  const refresh = useFocusStore((s) => s.refresh);
  const [days, setDays] = useState<Weekday[]>(['mon', 'tue', 'wed', 'thu', 'fri']);
  const [start, setStart] = useState('09:00');
  const [end, setEnd] = useState('17:00');
  const [locked, setLocked] = useState(false);
  const [profileId, setProfileId] = useState<string>(KEEP_ACTIVE);
  const [error, setError] = useState<string | null>(null);
  const scheduleEnabled = isScheduleEnabled(productLimits);
  const profileFor = (id: string | undefined) =>
    id ? profiles.find((p) => p.id === id) : undefined;
  const activeProfile = resolveActiveProfile(profiles, activeProfileId);
  const hasWindows = schedule.windows.length > 0;
  const legend = dialLegend(schedule, profiles, activeProfileId);

  async function save(windows: ScheduleWindow[]) {
    setError(null);
    try {
      await request('setSchedule', { schedule: { windows } });
      await refresh();
    } catch (e) {
      setError((e as Error).message);
    }
  }

  const toggleDay = (d: Weekday) =>
    setDays((cur) => (cur.includes(d) ? cur.filter((x) => x !== d) : [...cur, d]));

  const addWindow = () => {
    if (!scheduleEnabled) return onUpgrade();
    if (days.length === 0) return setError('Pick at least one day.');
    const w: ScheduleWindow = {
      id: newId(),
      days,
      start,
      end,
      locked,
      ...(profileId ? { profileId } : {}),
    };
    void save([...schedule.windows, w]);
  };
  const removeWindow = (id: string) => save(schedule.windows.filter((w) => w.id !== id));

  return (
    <div className="flex h-full min-h-0 gap-5 py-3">
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex items-baseline justify-between">
          <Kicker>Week dial · 24h per ring</Kicker>
          <span className="font-mono text-[10px] tracking-[0.1em] text-slate-600">
            OUTER = MON · 00H AT TOP
          </span>
        </div>

        {hasWindows ? (
          <div className="flex min-h-0 flex-1 items-center justify-center">
            <WeekDial
              schedule={schedule}
              profiles={profiles}
              activeProfileId={activeProfileId}
            />
          </div>
        ) : (
          <div className="mt-3 flex min-h-0 flex-1 flex-col items-center justify-center gap-2 rounded-[11px] border border-dashed border-white/[0.10] p-6 text-center">
            <span className="text-[15px] font-semibold text-slate-250">Nothing scheduled</span>
            <span className="max-w-sm text-[12px] leading-relaxed text-slate-400">
              Focus stays on whichever profile you picked by hand. Add a window to have Talysman
              switch profiles for you.
            </span>
          </div>
        )}

        <div className="mt-2 flex flex-wrap items-center gap-x-5 gap-y-2 border-t border-white/[0.06] pt-3">
          {hasWindows ? (
            <>
              {legend.slices.map((s) => (
                <span key={s.profile?.id ?? 'unknown'} className="flex items-center gap-2">
                  <ProfileDot color={s.profile?.color ?? '#5a5f67'} size={9} />
                  <span className="text-[12px] font-medium text-slate-200">
                    {s.profile?.name ?? 'Active profile'}
                  </span>
                  <span className="font-mono text-[10px] text-slate-450">{hours(s.hours)}</span>
                </span>
              ))}
              {legend.lockedHours > 0 && (
                <span className="flex items-center gap-2">
                  <span
                    className="block h-[9px] w-[9px] rounded-[2px]"
                    style={{
                      background:
                        'repeating-linear-gradient(135deg,#ff9d9d 0 2px,transparent 2px 4px)',
                    }}
                  />
                  <span className="text-[12px] text-slate-400">Locked</span>
                  <span className="font-mono text-[10px] text-slate-450">
                    {hours(legend.lockedHours)}
                  </span>
                </span>
              )}
              <span className="flex items-center gap-2">
                <span className="block h-[9px] w-[9px] rounded-[2px] bg-white/10" />
                <span className="text-[12px] text-slate-400">Unscheduled</span>
                <span className="font-mono text-[10px] text-slate-450">
                  {hours(legend.unscheduledHours)}
                </span>
              </span>
            </>
          ) : (
            <span className="text-[11.5px] text-slate-400">
              Every hour runs on{' '}
              <span className="text-slate-200">{activeProfile?.name ?? 'the active profile'}</span>.
            </span>
          )}
        </div>
      </div>

      <aside className="flex w-[320px] shrink-0 flex-col gap-4 overflow-y-auto border-l border-white/[0.06] pl-5">
        <div>
          <div className="flex items-baseline justify-between">
            <Kicker>Add a window</Kicker>
            {!scheduleEnabled && <Badge tone="neutral">Pro</Badge>}
          </div>

          <div className="mt-3 flex flex-wrap gap-1.5">
            {WEEKDAYS.map((d) => (
              <button
                key={d}
                onClick={() => toggleDay(d)}
                disabled={!scheduleEnabled}
                className={cx(
                  'rounded-md px-2.5 py-1 font-mono text-[10px] font-medium uppercase tracking-[0.08em] transition disabled:cursor-not-allowed disabled:opacity-50',
                  days.includes(d)
                    ? 'border border-seal/30 bg-seal/[0.14] text-sealInk'
                    : 'border border-white/[0.08] bg-white/[0.04] text-slate-400 hover:bg-white/[0.08]',
                )}
              >
                {d}
              </button>
            ))}
          </div>

          <div className="mt-3 flex items-center gap-2">
            <label className="font-mono text-[10px] uppercase tracking-[0.14em] text-slate-500">
              From
            </label>
            <Input
              type="time"
              value={start}
              onChange={(e) => setStart(e.target.value)}
              className="w-28 font-mono"
              disabled={!scheduleEnabled}
            />
            <label className="font-mono text-[10px] uppercase tracking-[0.14em] text-slate-500">
              to
            </label>
            <Input
              type="time"
              value={end}
              onChange={(e) => setEnd(e.target.value)}
              className="w-28 font-mono"
              disabled={!scheduleEnabled}
            />
          </div>

          <label
            className="mt-3 mb-1.5 block font-mono text-[10px] uppercase tracking-[0.14em] text-slate-500"
            htmlFor="window-profile"
          >
            Blocking profile
          </label>
          <Select
            id="window-profile"
            value={profileId}
            onChange={(e) => setProfileId(e.target.value)}
            disabled={!scheduleEnabled}
          >
            <option value={KEEP_ACTIVE}>
              Keep the active profile{activeProfile ? ` (now: ${activeProfile.name})` : ''}
            </option>
            {profiles.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </Select>
          <p className="mt-2 text-[11px] leading-relaxed text-slate-450">
            Focus switches to this profile for the length of the window, then leaves it in place.
          </p>

          <label className="mt-3 flex items-center gap-2 text-[12px] text-slate-300">
            <input
              type="checkbox"
              className="accent-seal"
              checked={locked}
              onChange={(e) => setLocked(e.target.checked)}
              disabled={!scheduleEnabled}
            />
            Locked window (USB key cannot disable focus)
          </label>

          <Button onClick={addWindow} className="mt-3 w-full">
            {scheduleEnabled ? 'Add window' : 'Upgrade for scheduling'}
          </Button>
          {error && <p className="mt-2 text-[12px] text-dangerInk">{error}</p>}
        </div>

        <div className="border-t border-white/[0.06] pt-4">
          <Kicker>Windows · {schedule.windows.length}</Kicker>
          <ul className="mt-3 flex flex-col gap-1.5">
            {schedule.windows.map((w) => {
              const profile = profileFor(w.profileId);
              return (
                <li
                  key={w.id}
                  className="flex items-start justify-between gap-3 rounded-[10px] border border-white/[0.06] bg-white/[0.025] px-3 py-2"
                >
                  <span className="min-w-0">
                    <span className="font-mono text-[11.5px] text-slate-200">
                      {w.days.join(', ')} - {w.start}-{w.end}{' '}
                      {w.locked && <Badge tone="danger">locked</Badge>}
                    </span>
                    <span className="mt-1 flex items-center gap-1.5 text-[11px] text-slate-450">
                      {profile ? (
                        <>
                          <ProfileDot color={profile.color} size={7} />
                          {profile.name}
                        </>
                      ) : (
                        'keeps the active profile'
                      )}
                    </span>
                  </span>
                  <button
                    onClick={() => removeWindow(w.id)}
                    className="shrink-0 text-[11px] font-medium text-slate-500 transition hover:text-dangerInk"
                  >
                    remove
                  </button>
                </li>
              );
            })}
            {schedule.windows.length === 0 && (
              <p className="text-[12px] text-slate-500">No windows yet.</p>
            )}
          </ul>
        </div>
      </aside>
    </div>
  );
}
