import React, { useEffect, useState } from 'react';
import { resolveActiveProfile } from '@talysman/shared';
import { useFocusStore } from './store/useFocusStore.js';
import { TalysmanMark } from './components/TalysmanMark.js';
import { Dashboard } from './pages/Dashboard.js';
import { Blocklists } from './pages/Blocklists.js';
import { SchedulePage } from './pages/Schedule.js';
import { Keys } from './pages/Keys.js';
import { Account } from './pages/Account.js';
import { Settings } from './pages/Settings.js';
import { Plans } from './pages/Plans.js';
import { ProfileDot } from './components/ui/index.js';
import { cx } from './lib/utils.js';

type Route = 'dashboard' | 'blocklists' | 'schedule' | 'keys' | 'account' | 'plans' | 'settings';

const NAV: { route: Route; label: string }[] = [
  { route: 'dashboard', label: 'Dashboard' },
  { route: 'blocklists', label: 'Blocklists' },
  { route: 'schedule', label: 'Schedule' },
  { route: 'keys', label: 'Keys' },
  { route: 'account', label: 'Account' },
  { route: 'settings', label: 'Settings' },
];

const MODE_LABELS: Record<string, string> = {
  blacklist: 'Blacklist',
  whitelist: 'Whitelist',
  'block-all': 'Block all',
};

export default function App() {
  const init = useFocusStore((s) => s.init);
  const ready = useFocusStore((s) => s.ready);
  const usingMock = useFocusStore((s) => s.usingMock);
  const keyPresent = useFocusStore((s) => s.keyPresent);
  const focusActive = useFocusStore((s) => s.focusActive);
  const policy = useFocusStore((s) => s.policy);
  const profiles = useFocusStore((s) => s.profiles);
  const activeProfileId = useFocusStore((s) => s.activeProfileId);
  const watchdogWarning = useFocusStore((s) => s.watchdogWarning);
  const clearWatchdogWarning = useFocusStore((s) => s.clearWatchdogWarning);
  const passwordRecovery = useFocusStore((s) => s.passwordRecovery);
  const [route, setRoute] = useState<Route>('dashboard');
  const activeProfile = resolveActiveProfile(profiles, activeProfileId);

  useEffect(() => {
    void init();
  }, [init]);

  // A password-recovery deep link needs the Account page's reset form on screen.
  useEffect(() => {
    if (passwordRecovery) setRoute('account');
  }, [passwordRecovery]);

  // Auto-dismiss the watchdog warning after a few seconds; it's a transient nudge.
  useEffect(() => {
    if (!watchdogWarning) return;
    const t = setTimeout(() => clearWatchdogWarning(), 8000);
    return () => clearTimeout(t);
  }, [watchdogWarning, clearWatchdogWarning]);

  const routeLabel = NAV.find((n) => n.route === route)?.label ?? 'Plans';
  // The whole canvas is tinted by whether the shield is up: teal when enforcing, a warmer
  // amber when nothing is being blocked. It's the fastest read of state in the app.
  const ambient = focusActive ? 'rgba(79,214,192,0.10)' : 'rgba(255,180,84,0.07)';

  return (
    <div className="relative flex h-full flex-col overflow-hidden bg-bg text-slate-200">
      {/* Atmosphere: ambient bloom, a hairline survey grid, then a vignette to sink the corners. */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0"
        style={{ background: `radial-gradient(720px 720px at 50% 38%, ${ambient}, transparent 68%)` }}
      />
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0"
        style={{
          backgroundImage:
            'linear-gradient(rgba(255,255,255,0.02) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.02) 1px, transparent 1px)',
          backgroundSize: '44px 44px',
        }}
      />
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0"
        style={{
          background: 'radial-gradient(circle at 50% 44%, transparent 34%, rgba(6,7,10,0.92) 100%)',
        }}
      />

      <header className="relative z-10 flex h-12 shrink-0 items-center gap-3 px-5">
        <TalysmanMark size={18} className="opacity-80" />
        <span className="font-mono text-[11px] font-bold tracking-[0.18em] text-slate-400">
          TALYSMAN
        </span>
        <span className="font-mono text-[11px] tracking-[0.14em] text-slate-600">
          / {routeLabel.toUpperCase()}
        </span>
        {import.meta.env.DEV && (
          <span className="rounded border border-danger/50 px-1.5 font-mono text-[10px] font-bold tracking-[0.14em] text-danger">
            DEV
          </span>
        )}
        {usingMock && (
          <span className="font-mono text-[10px] tracking-[0.14em] text-warn">MOCK SERVICE</span>
        )}

        <button
          onClick={() => setRoute('keys')}
          className={cx(
            'ml-auto flex items-center gap-2 rounded-full border py-1.5 pl-2.5 pr-3 backdrop-blur-sm transition',
            keyPresent
              ? 'border-seal/30 bg-seal/[0.09] hover:bg-seal/[0.14]'
              : 'border-danger/30 bg-danger/[0.10] hover:bg-danger/[0.16]',
          )}
        >
          <span
            className={cx(
              'block h-[7px] w-[7px] animate-pulse rounded-full',
              keyPresent
                ? 'bg-seal shadow-[0_0_8px_2px_rgba(79,214,192,0.6)]'
                : 'bg-danger shadow-[0_0_8px_2px_rgba(255,107,107,0.55)]',
            )}
          />
          <span
            className={cx(
              'font-mono text-[10.5px] font-medium tracking-[0.12em]',
              keyPresent ? 'text-sealInk' : 'text-dangerInk',
            )}
          >
            {keyPresent ? 'KEY PRESENT' : 'NO KEY'}
          </span>
        </button>
      </header>

      {watchdogWarning && (
        <div className="pointer-events-none absolute inset-x-0 top-12 z-50 flex justify-center p-4">
          <div className="pointer-events-auto flex items-center gap-3 rounded-[10px] border border-warn/40 bg-warn/[0.10] px-4 py-2 text-[12.5px] text-warn backdrop-blur-md">
            <span>
              {watchdogWarning.browser} isn’t proving the Talysman extension is active — it will be
              closed if it stays unprotected.
            </span>
            <button
              onClick={() => clearWatchdogWarning()}
              className="rounded px-2 py-0.5 font-medium hover:bg-warn/20"
            >
              Dismiss
            </button>
          </div>
        </div>
      )}

      <main className="relative z-10 min-h-0 flex-1 overflow-y-auto px-5 pb-6">
        {!ready ? (
          <div className="flex h-full items-center justify-center text-slate-500">Connecting…</div>
        ) : (
          <div key={route} className="h-full animate-rise">
            {route === 'dashboard' && <Dashboard />}
            {route === 'blocklists' && <Blocklists onUpgrade={() => setRoute('plans')} />}
            {route === 'schedule' && <SchedulePage onUpgrade={() => setRoute('plans')} />}
            {route === 'keys' && <Keys />}
            {route === 'account' && <Account onUpgrade={() => setRoute('plans')} />}
            {route === 'plans' && <Plans />}
            {route === 'settings' && <Settings />}
          </div>
        )}
      </main>

      <footer className="relative z-10 flex h-[66px] shrink-0 items-center justify-between border-t border-white/[0.06] bg-[rgba(8,9,12,0.72)] px-5 backdrop-blur-xl">
        <div className="flex items-center gap-2.5">
          <ProfileDot color={focusActive ? (activeProfile?.color ?? '#4fd6c0') : '#5a5f67'} />
          <div>
            <div className="font-mono text-[9.5px] tracking-[0.14em] text-slate-450">MODE</div>
            <div className="mt-0.5 text-[13px] font-medium text-slate-200">
              {focusActive ? (MODE_LABELS[policy.mode] ?? policy.mode) : 'Off'}
            </div>
          </div>
        </div>

        <nav className="flex gap-0.5 rounded-full border border-white/[0.07] bg-white/[0.05] p-[3px]">
          {NAV.map((n) => (
            <button
              key={n.route}
              onClick={() => setRoute(n.route)}
              className={cx(
                'rounded-full px-3.5 py-1.5 text-[12.5px] font-medium transition',
                route === n.route
                  ? 'bg-white/[0.10] text-white'
                  : 'text-slate-400 hover:bg-white/[0.05] hover:text-slate-200',
              )}
            >
              {n.label}
            </button>
          ))}
        </nav>
      </footer>
    </div>
  );
}
