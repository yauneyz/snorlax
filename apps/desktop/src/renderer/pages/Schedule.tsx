import React, { useState } from 'react';
import type { ScheduleWindow, Weekday } from '@talysman/shared';
import { WEEKDAYS } from '@talysman/shared';
import { request } from '../lib/bridge.js';
import { useFocusStore } from '../store/useFocusStore.js';
import { Badge, Button, Card, CardTitle, Input } from '../components/ui/index.js';
import { isScheduleEnabled } from '../../shared/productLimits.js';

let idCounter = 0;
const newId = () => `win-${Date.now()}-${idCounter++}`;

export function SchedulePage({ onUpgrade }: { onUpgrade: () => void }) {
  const schedule = useFocusStore((s) => s.schedule);
  const productLimits = useFocusStore((s) => s.productLimits);
  const refresh = useFocusStore((s) => s.refresh);
  const [days, setDays] = useState<Weekday[]>(['mon', 'tue', 'wed', 'thu', 'fri']);
  const [start, setStart] = useState('09:00');
  const [end, setEnd] = useState('17:00');
  const [locked, setLocked] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const scheduleEnabled = isScheduleEnabled(productLimits);

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
    const w: ScheduleWindow = { id: newId(), days, start, end, locked };
    void save([...schedule.windows, w]);
  };
  const removeWindow = (id: string) => save(schedule.windows.filter((w) => w.id !== id));

  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
      <Card>
        <div className="mb-3 flex items-start justify-between gap-3">
          <CardTitle hint="Focus turns on automatically during these windows, even with the app closed.">
            Add a window
          </CardTitle>
          {!scheduleEnabled && <Badge tone="neutral">Pro</Badge>}
        </div>
        <div className="mb-4 flex flex-wrap gap-2">
          {WEEKDAYS.map((d) => (
            <button
              key={d}
              onClick={() => toggleDay(d)}
              disabled={!scheduleEnabled}
              className={`rounded-md px-3 py-1.5 text-xs font-medium uppercase disabled:cursor-not-allowed disabled:opacity-50 ${
                days.includes(d)
                  ? 'bg-accent text-accentInk'
                  : 'border border-white/[0.08] bg-white/[0.04] text-slate-400 hover:bg-white/[0.08]'
              }`}
            >
              {d}
            </button>
          ))}
        </div>
        <div className="mb-4 flex items-center gap-3">
          <label className="text-sm text-slate-400">From</label>
          <Input
            type="time"
            value={start}
            onChange={(e) => setStart(e.target.value)}
            className="w-32"
            disabled={!scheduleEnabled}
          />
          <label className="text-sm text-slate-400">to</label>
          <Input
            type="time"
            value={end}
            onChange={(e) => setEnd(e.target.value)}
            className="w-32"
            disabled={!scheduleEnabled}
          />
        </div>
        <label className="mb-4 flex items-center gap-2 text-sm text-slate-300">
          <input
            type="checkbox"
            checked={locked}
            onChange={(e) => setLocked(e.target.checked)}
            disabled={!scheduleEnabled}
          />
          Locked window (USB key cannot disable focus)
        </label>
        <Button onClick={addWindow}>{scheduleEnabled ? 'Add window' : 'Upgrade for scheduling'}</Button>
        {error && <p className="mt-3 text-sm text-red-400">{error}</p>}
      </Card>

      <Card>
        <CardTitle>Scheduled windows</CardTitle>
        <ul className="flex flex-col gap-2">
          {schedule.windows.map((w) => (
            <li key={w.id} className="flex items-center justify-between rounded-lg bg-panel2 px-3 py-2">
              <span className="text-sm text-slate-200">
                {w.days.join(', ')} - {w.start}-{w.end} {w.locked && <Badge tone="danger">locked</Badge>}
              </span>
              <button onClick={() => removeWindow(w.id)} className="text-xs text-red-400 hover:underline">
                remove
              </button>
            </li>
          ))}
          {schedule.windows.length === 0 && <p className="text-sm text-slate-500">No windows yet.</p>}
        </ul>
      </Card>
    </div>
  );
}
