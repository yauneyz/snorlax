import React, { useEffect, useState } from 'react';
import { useFocusStore } from './store/useFocusStore.js';
import { UsbIndicator } from './components/UsbIndicator.js';
import { Dashboard } from './pages/Dashboard.js';
import { Blocklists } from './pages/Blocklists.js';
import { SchedulePage } from './pages/Schedule.js';
import { Keys } from './pages/Keys.js';
import { Account } from './pages/Account.js';
import { Settings } from './pages/Settings.js';
import { cx } from './lib/utils.js';

type Route = 'dashboard' | 'blocklists' | 'schedule' | 'keys' | 'account' | 'settings';

const NAV: { route: Route; label: string }[] = [
  { route: 'dashboard', label: 'Dashboard' },
  { route: 'blocklists', label: 'Blocklists' },
  { route: 'schedule', label: 'Schedule' },
  { route: 'keys', label: 'Keys' },
  { route: 'account', label: 'Account' },
  { route: 'settings', label: 'Settings' },
];

export default function App() {
  const init = useFocusStore((s) => s.init);
  const ready = useFocusStore((s) => s.ready);
  const usingMock = useFocusStore((s) => s.usingMock);
  const [route, setRoute] = useState<Route>('dashboard');

  useEffect(() => {
    void init();
  }, [init]);

  return (
    <div className="flex h-full">
      <aside className="flex w-56 flex-col border-r border-border bg-panel">
        <div className="flex items-center gap-2 px-5 py-5">
          <span className="text-lg font-bold text-white">FocusLock</span>
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

      <main className="flex-1 overflow-auto p-8">
        {!ready ? (
          <div className="flex h-full items-center justify-center text-slate-500">Connecting…</div>
        ) : (
          <>
            {route === 'dashboard' && <Dashboard />}
            {route === 'blocklists' && <Blocklists />}
            {route === 'schedule' && <SchedulePage />}
            {route === 'keys' && <Keys />}
            {route === 'account' && <Account />}
            {route === 'settings' && <Settings />}
          </>
        )}
      </main>
    </div>
  );
}
