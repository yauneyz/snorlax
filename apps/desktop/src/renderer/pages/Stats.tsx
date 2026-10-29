import React, { useCallback, useEffect, useMemo, useState } from 'react';
import type { JournalEntry, StatsData } from '@talysman/shared';
import { useFocusStore } from '../store/useFocusStore.js';
import { request } from '../lib/bridge.js';
import { Button, Card, CardTitle, Kicker } from '../components/ui/index.js';
import { cx } from '../lib/utils.js';
import { formatHours, percentChange, summarize, type RangeDays, type StatsSummary } from '../lib/stats.js';

const RANGES: { days: RangeDays; label: string }[] = [
  { days: 7, label: '7 days' },
  { days: 30, label: '30 days' },
];
const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const TOP_SITES = 8;
const REFRESH_MS = 60_000;

export function Stats() {
  const [range, setRange] = useState<RangeDays>(7);
  const [data, setData] = useState<StatsData | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());

  const load = useCallback(async () => {
    try {
      setData(await request('getStats', undefined));
      setLoadError(null);
    } catch (e) {
      setLoadError((e as Error).message);
    }
    setNow(Date.now());
  }, []);

  useEffect(() => {
    void load();
    const t = window.setInterval(() => void load(), REFRESH_MS);
    return () => window.clearInterval(t);
  }, [load]);

  const summary = useMemo(() => (data ? summarize(data, range, now) : null), [data, range, now]);

  if (loadError && !data) {
    return (
      <div className="py-6">
        <Card>
          <CardTitle hint="Update Talysman to the latest version to see your stats.">Stats unavailable</CardTitle>
          <p className="text-body text-slate-450">{loadError}</p>
        </Card>
      </div>
    );
  }
  if (!summary) return <div className="flex h-full items-center justify-center text-slate-500">Loading…</div>;

  return (
    <div className="flex flex-col gap-4 py-6">
      <div className="flex items-center gap-3">
        <Kicker>Last {range} days</Kicker>
        <div role="tablist" aria-label="Range" className="ml-auto flex rounded-full border border-white/[0.09] bg-white/[0.03] p-0.5">
          {RANGES.map((r) => (
            <button
              key={r.days}
              role="tab"
              aria-selected={range === r.days}
              onClick={() => setRange(r.days)}
              className={cx(
                'rounded-full px-3 py-1 text-caption font-medium transition',
                range === r.days ? 'bg-white/[0.09] text-white' : 'text-slate-400 hover:text-slate-200',
              )}
            >
              {r.label}
            </button>
          ))}
        </div>
      </div>

      <Tiles summary={summary} range={range} />
      <FocusByDay summary={summary} range={range} />

      <div className="grid gap-4 md:grid-cols-2">
        <WhenYouFocus summary={summary} />
        <BlockedSites summary={summary} range={range} onChanged={load} />
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <LedgerCard summary={summary} />
        <RecentActivity entries={summary.recent} />
      </div>

      <p className="text-center text-caption text-slate-500">
        Stats are worked out on this computer from what Talysman keeps locally — about the last month.
      </p>
    </div>
  );
}

function Delta({ change, invert = false }: { change: number | null; invert?: boolean }) {
  if (change === null || change === 0) return null;
  const good = invert ? change < 0 : change > 0;
  return (
    <span className={cx('font-mono text-caption', good ? 'text-okInk' : 'text-slate-450')}>
      {change > 0 ? '▲' : '▼'} {Math.abs(change)}%
    </span>
  );
}

function Tile({ label, value, detail }: { label: string; value: string; detail?: React.ReactNode }) {
  return (
    <Card className="!p-4">
      <Kicker className="text-caption">{label}</Kicker>
      <div className="mt-1.5 text-display font-semibold text-slate-100">{value}</div>
      <div className="mt-0.5 flex min-h-[18px] items-center gap-2 text-caption text-slate-450">{detail}</div>
    </Card>
  );
}

function Tiles({ summary, range }: { summary: StatsSummary; range: RangeDays }) {
  const streak = useFocusStore((s) => s.engine.streak);
  const showStreak = useFocusStore((s) => s.settings.streakBadgeEnabled);
  return (
    <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
      <Tile
        label="Focus time"
        value={formatHours(summary.focusMs)}
        detail={
          <>
            <Delta change={percentChange(summary.focusMs, summary.prevFocusMs)} />
            {summary.prevFocusMs !== null && <span>vs previous {range} days</span>}
          </>
        }
      />
      <Tile label="Daily average" value={formatHours(summary.focusMs / range)} />
      {showStreak ? (
        <Tile
          label="Streak"
          value={`${streak.currentDays} ${streak.currentDays === 1 ? 'day' : 'days'}`}
          detail={streak.bestDays > streak.currentDays ? `best ${streak.bestDays}` : streak.currentDays > 0 ? 'your best yet' : undefined}
        />
      ) : (
        <Tile label="Sessions" value={String(summary.sessions)} />
      )}
      <Tile
        label="Longest session"
        value={formatHours(summary.longestSessionMs)}
        detail={showStreak ? `${summary.sessions} ${summary.sessions === 1 ? 'session' : 'sessions'}` : undefined}
      />
    </div>
  );
}

function FocusByDay({ summary, range }: { summary: StatsSummary; range: RangeDays }) {
  const max = Math.max(...summary.days.map((d) => d.focusMs), 0);
  const empty = max === 0;
  const label = (startMs: number, i: number) => {
    const d = new Date(startMs);
    if (range === 7) return d.toLocaleDateString([], { weekday: 'short' });
    return i % 5 === 0 || i === summary.days.length - 1 ? String(d.getDate()) : '';
  };
  return (
    <Card>
      <div className="mb-3 flex items-baseline gap-3">
        <h2 className="text-heading font-semibold text-slate-400">Focus by day</h2>
        {!empty && <span className="ml-auto font-mono text-caption text-slate-500">peak {formatHours(max)}</span>}
      </div>
      {empty ? (
        <p className="py-8 text-center text-body text-slate-450">
          No focus time yet in this period. Turn on a mode and it shows up here.
        </p>
      ) : (
        <>
          <div className="flex h-32 items-end gap-[2px] border-b border-white/[0.08]">
            {summary.days.map((d) => (
              <div
                key={d.date}
                title={`${new Date(d.startMs).toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' })} · ${formatHours(d.focusMs)}`}
                className="group flex h-full flex-1 items-end"
              >
                <div
                  className="w-full rounded-t-[4px] bg-signal/80 transition group-hover:bg-signal"
                  style={{ height: d.focusMs > 0 ? `max(2px, ${(d.focusMs / max) * 100}%)` : 0 }}
                />
              </div>
            ))}
          </div>
          <div className="mt-1.5 flex gap-[2px]">
            {summary.days.map((d, i) => (
              <span key={d.date} className="flex-1 text-center font-mono text-caption text-slate-500">
                {label(d.startMs, i)}
              </span>
            ))}
          </div>
        </>
      )}
      {summary.scheduledShare !== null && (
        <p className="mt-3 text-caption text-slate-450">
          {Math.round(summary.scheduledShare * 100)}% of sessions started on a schedule, {100 - Math.round(summary.scheduledShare * 100)}% by you.
        </p>
      )}
    </Card>
  );
}

const HEAT_STEPS = ['bg-signal/20', 'bg-signal/40', 'bg-signal/60', 'bg-signal/80', 'bg-signal'];

function hourLabel(hour: number): string {
  const h = hour % 12 === 0 ? 12 : hour % 12;
  return `${h} ${hour < 12 ? 'AM' : 'PM'}`;
}

function WhenYouFocus({ summary }: { summary: StatsSummary }) {
  const max = Math.max(...summary.hourGrid.flat(), 0);
  return (
    <Card>
      <CardTitle>When you focus</CardTitle>
      <div className="grid grid-cols-[auto_repeat(24,minmax(0,1fr))] gap-[2px]">
        {summary.hourGrid.map((row, day) => (
          <React.Fragment key={day}>
            <span className="pr-2 font-mono text-caption leading-[14px] text-slate-500">{WEEKDAYS[day]![0]}</span>
            {row.map((ms, hour) => (
              <span
                key={hour}
                title={`${WEEKDAYS[day]} ${hourLabel(hour)} · ${formatHours(ms)}`}
                className={cx(
                  'h-3.5 rounded-[3px]',
                  ms > 0 && max > 0 ? HEAT_STEPS[Math.min(HEAT_STEPS.length - 1, Math.floor((ms / max) * HEAT_STEPS.length))] : 'bg-white/[0.04]',
                )}
              />
            ))}
          </React.Fragment>
        ))}
        <span />
        {Array.from({ length: 24 }, (_, hour) => (
          <span key={hour} className="pt-1 font-mono text-[10px] text-slate-500">
            {hour % 6 === 0 ? hourLabel(hour).replace(' ', '').toLowerCase() : ''}
          </span>
        ))}
      </div>
      {max === 0 && <p className="mt-3 text-caption text-slate-450">Fills in as you build focus time.</p>}
    </Card>
  );
}

/**
 * Opt-in blocked-site counts. Off by default; turning it on only makes this device start counting
 * (nothing is uploaded), and turning it off deletes what was counted.
 */
function BlockedSites({ summary, range, onChanged }: { summary: StatsSummary; range: RangeDays; onChanged: () => Promise<void> }) {
  const enabled = useFocusStore((s) => s.settings.blockedSiteStatsEnabled);
  const setEnabled = useFocusStore((s) => s.setBlockedSiteStatsEnabled);
  const [confirming, setConfirming] = useState<'delete' | 'off' | null>(null);
  const [showAll, setShowAll] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function run(action: () => Promise<unknown>) {
    setBusy(true);
    setError(null);
    try {
      await action();
      setConfirming(null);
      await onChanged();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const localOnly = 'Stored only on this computer. Never sent to Talysman or anyone else.';

  if (!enabled) {
    return (
      <Card>
        <CardTitle hint="See which sites get blocked most often. When this is on, Talysman counts blocked visits to each site, per day — just the site name, never full addresses.">
          Blocked sites
        </CardTitle>
        <p className="mb-4 rounded-[10px] border border-white/[0.08] bg-white/[0.03] px-3 py-2.5 text-body text-slate-300">
          {localOnly} Turn it off any time — that deletes everything it counted.
        </p>
        <Button disabled={busy} onClick={() => void run(() => setEnabled(true))}>
          Turn on
        </Button>
        {error && <p className="mt-3 text-body text-warn">{error}</p>}
      </Card>
    );
  }

  const sites = showAll ? summary.topSites : summary.topSites.slice(0, TOP_SITES);
  const max = summary.topSites[0]?.count ?? 0;
  return (
    <Card>
      <div className="mb-3 flex items-baseline gap-3">
        <h2 className="text-heading font-semibold text-slate-400">Blocked sites</h2>
        <span className="ml-auto flex items-center gap-2 text-caption text-slate-450">
          <Delta change={percentChange(summary.blockedTotal, summary.prevBlockedTotal)} invert />
          {summary.blockedTotal} {summary.blockedTotal === 1 ? 'visit' : 'visits'}
        </span>
      </div>
      {sites.length === 0 ? (
        <p className="py-4 text-body text-slate-450">Nothing blocked in the last {range} days.</p>
      ) : (
        <ul className="flex flex-col gap-1.5">
          {sites.map((site) => (
            <li key={site.host} className="grid grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)_auto] items-center gap-3 text-body">
              <span className="truncate text-slate-200">{site.host}</span>
              <span className="h-2 rounded-full bg-white/[0.04]">
                <span className="block h-full rounded-full bg-signal/80" style={{ width: `${(site.count / max) * 100}%` }} />
              </span>
              <span className="w-8 text-right font-mono text-caption text-slate-400">{site.count}</span>
            </li>
          ))}
        </ul>
      )}
      {summary.topSites.length > TOP_SITES && (
        <button onClick={() => setShowAll((v) => !v)} className="mt-2 text-caption text-slate-400 hover:text-slate-200">
          {showAll ? 'Show fewer' : `Show ${summary.topSites.length - TOP_SITES} more`}
        </button>
      )}

      <div className="mt-4 border-t border-white/[0.06] pt-3">
        {confirming ? (
          <div className="flex flex-wrap items-center gap-2">
            <span className="mr-auto text-body text-slate-300">
              {confirming === 'delete'
                ? 'Delete every recorded site? This can’t be undone.'
                : 'Turning this off deletes every recorded site.'}
            </span>
            <Button variant="ghost" disabled={busy} onClick={() => setConfirming(null)}>
              Cancel
            </Button>
            <Button
              variant="danger"
              disabled={busy}
              onClick={() =>
                void run(() => (confirming === 'delete' ? request('clearBlockedSiteStats', undefined) : setEnabled(false)))
              }
            >
              {confirming === 'delete' ? 'Delete' : 'Turn off and delete'}
            </Button>
          </div>
        ) : (
          <div className="flex flex-wrap items-center gap-2">
            <span className="mr-auto text-caption text-slate-450">{localOnly}</span>
            <Button variant="ghost" disabled={busy} onClick={() => setConfirming('delete')}>
              Delete history
            </Button>
            <Button variant="ghost" disabled={busy} onClick={() => setConfirming('off')}>
              Turn off
            </Button>
          </div>
        )}
        {error && <p className="mt-2 text-body text-warn">{error}</p>}
      </div>
    </Card>
  );
}

function LedgerRow({ label, value, detail }: { label: string; value: number; detail?: string }) {
  return (
    <li className="flex items-baseline gap-3 text-body">
      <span className="text-slate-300">{label}</span>
      <span className="ml-auto font-mono text-slate-100">{value}</span>
      <span className="w-20 text-right font-mono text-caption text-slate-450">{detail ?? ''}</span>
    </li>
  );
}

function LedgerCard({ summary }: { summary: StatsSummary }) {
  const l = summary.ledger;
  const emergencyLeft = useFocusStore((s) => s.engine.emergencyLeft);
  return (
    <Card>
      <CardTitle>Unlocks and pauses</CardTitle>
      <ul className="flex flex-col gap-2">
        <LedgerRow label="Unlocks used" value={l.poolUnlocks} detail={l.poolUnlocks ? `${l.poolMinutes} min` : undefined} />
        <LedgerRow label="Pauses" value={l.pauses} detail={l.pauses ? formatHours(l.pausedMs) : undefined} />
        <LedgerRow label="Turned off with key" value={l.turnedOff} detail={l.turnedOff ? formatHours(l.turnedOffMs) : undefined} />
        <LedgerRow label="Exemptions" value={l.exemptions} />
        <LedgerRow label="Emergency unlocks" value={l.emergencies} detail={`${emergencyLeft} left`} />
      </ul>
    </Card>
  );
}

function describe(entry: JournalEntry, profileName: (id: string) => string): string {
  const k = entry.kind;
  switch (k.kind) {
    case 'profileOn':
      return `${profileName(k.profileId)} turned on${k.source === 'schedule' || k.source === 'oneShot' ? ' on schedule' : ''}`;
    case 'profileOff':
      return `${profileName(k.profileId)} turned off${k.source === 'schedule' || k.source === 'oneShot' ? ' on schedule' : ''}`;
    case 'overrideStarted':
      return k.override === 'timed' ? 'Paused blocking' : k.override === 'exempt' ? 'Exempted something from blocking' : 'Turned blocking off with key';
    case 'reenabledAll':
      return 'Turned blocking back on';
    case 'relaxed':
      return `Loosened ${profileName(k.profileId)}`;
    case 'poolUnlocked':
      return `Unlocked for ${k.minutes} min`;
    case 'emergencyUsed':
      return 'Used an emergency unlock';
    default:
      return '';
  }
}

function RecentActivity({ entries }: { entries: JournalEntry[] }) {
  const profiles = useFocusStore((s) => s.profiles);
  const profileName = (id: string) => profiles.find((p) => p.id === id)?.name ?? 'A deleted mode';
  return (
    <Card>
      <CardTitle>Recent activity</CardTitle>
      {entries.length === 0 ? (
        <p className="text-body text-slate-450">Nothing yet in this period.</p>
      ) : (
        <ul className="flex flex-col gap-1.5">
          {entries.map((e) => (
            <li key={e.id} className="flex items-baseline gap-3 text-body">
              <span className={cx('truncate', e.breaksStreak ? 'text-slate-200' : 'text-slate-300')}>{describe(e, profileName)}</span>
              <span className="ml-auto shrink-0 font-mono text-caption text-slate-500">
                {new Date(e.atMs).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}
              </span>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
