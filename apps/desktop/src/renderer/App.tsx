import React, { useEffect, useState } from 'react';
import { useFocusStore } from './store/useFocusStore.js';
import { UsbIndicator } from './components/UsbIndicator.js';
import { Dashboard } from './pages/Dashboard.js';
import { Blocklists } from './pages/Blocklists.js';
import { SchedulePage } from './pages/Schedule.js';
import { Keys } from './pages/Keys.js';
import { Account } from './pages/Account.js';
import { Settings } from './pages/Settings.js';
import { Plans } from './pages/Plans.js';
import { cx } from './lib/utils.js';

type Route = 'dashboard' | 'blocklists' | 'schedule' | 'keys' | 'account' | 'plans' | 'settings';

const NAV: { route: Route; label: string }[] = [
  { route: 'dashboard', label: 'Dashboard' },
  { route: 'blocklists', label: 'Blocklists' },
  { route: 'schedule', label: 'Schedule' },
  { route: 'keys', label: 'Keys' },
  { route: 'account', label: 'Account' },
  { route: 'plans', label: 'Plans' },
  { route: 'settings', label: 'Settings' },
];

export default function App() {
  const init = useFocusStore((s) => s.init);
  const ready = useFocusStore((s) => s.ready);
  const usingMock = useFocusStore((s) => s.usingMock);
  const watchdogWarning = useFocusStore((s) => s.watchdogWarning);
  const clearWatchdogWarning = useFocusStore((s) => s.clearWatchdogWarning);
  const [route, setRoute] = useState<Route>('dashboard');

  useEffect(() => {
    void init();
  }, [init]);

  // Auto-dismiss the watchdog warning after a few seconds; it's a transient nudge.
  useEffect(() => {
    if (!watchdogWarning) return;
    const t = setTimeout(() => clearWatchdogWarning(), 8000);
    return () => clearTimeout(t);
  }, [watchdogWarning, clearWatchdogWarning]);

  return (
    <div className="flex h-full">
      <aside className="flex w-56 flex-col border-r border-border bg-panel">
        <div className="flex items-center gap-2 px-5 py-5">
          <span className="text-lg font-bold text-white">Talysman</span>
        </div>
        <nav className="flex flex-col gap-1 px-3">
          {NAV.map((n) => (
            <button
              key={n.route}
              onClick={() => setRoute(n.route)}
              className={cx(
                'rounded-lg px-3 py-2 text-left text-sm font-medium transition',
                route === n.route ? 'bg-accent/15 text-white' : 'text-slate-400 hover:bg-panel2 hover:text-slate-200',
              )}
            >
              {n.label}
            </button>
          ))}
        </nav>
        <div className="mt-auto border-t border-border px-5 py-4">
          <UsbIndicator />
          {usingMock && <p className="mt-2 text-xs text-amber-400">mock service</p>}
        </div>
      </aside>

      {watchdogWarning && (
        <div className="pointer-events-none fixed inset-x-0 top-0 z-50 flex justify-center p-4">
          <div className="pointer-events-auto flex items-center gap-3 rounded-lg border border-amber-500/40 bg-amber-500/10 px-4 py-2 text-sm text-amber-200 shadow-lg">
            <span>
              {watchdogWarning.browser} isn’t proving the Talysman extension is active — it will be
              closed if it stays unprotected.
            </span>
            <button
              onClick={() => clearWatchdogWarning()}
              className="rounded px-2 py-0.5 text-amber-300 hover:bg-amber-500/20"
            >
              Dismiss
            </button>
          </div>
        </div>
      )}

      <main className="flex-1 overflow-auto p-8">
        {!ready ? (
          <div className="flex h-full items-center justify-center text-slate-500">Connecting…</div>
        ) : (
          <>
            {route === 'dashboard' && <Dashboard />}
            {route === 'blocklists' && <Blocklists onUpgrade={() => setRoute('plans')} />}
            {route === 'schedule' && <SchedulePage onUpgrade={() => setRoute('plans')} />}
            {route === 'keys' && <Keys />}
            {route === 'account' && <Account />}
            {route === 'plans' && <Plans />}
            {route === 'settings' && <Settings />}
          </>
        )}
      </main>
    </div>
  );
}
