import React, { useEffect, useState } from 'react';
import type { Policy } from '@talysman/shared';
import { palette } from '@talysman/shared';
import { desktopPaletteColor } from './lib/desktopPalette.js';
import { productFeaturesForEnvironment } from '@talysman/product';
import { useFocusStore } from './store/useFocusStore.js';
import { Dashboard } from './pages/Dashboard.js';
import { Stats } from './pages/Stats.js';
import { Blocklists } from './pages/Blocklists.js';
import { SchedulePage } from './pages/Schedule.js';
import { Keys } from './pages/Keys.js';
import { Account } from './pages/Account.js';
import { Settings } from './pages/Settings.js';
import { Plans } from './pages/Plans.js';
import { FirstRun } from './components/FirstRun.js';
import { TalysmanMark } from './components/TalysmanMark.js';
import { ProfileDot } from './components/ui/index.js';
import { OverrideDialog } from './components/OverrideDialog.js';
import { ArmConfirm } from './components/ArmConfirm.js';
import { AppMessageBanners } from './components/AppMessageBanners.js';
import { cx, effectiveAction } from './lib/utils.js';

export type Route = 'dashboard' | 'stats' | 'blocklists' | 'schedule' | 'keys' | 'account' | 'plans' | 'settings';

/** Nav glyphs: 24-unit line drawings, sized and coloured by the nav item they sit in. */
const NAV_ICONS = {
  dashboard: (
    <>
      <rect x="3" y="3" width="7" height="9" rx="1.5" />
      <rect x="14" y="3" width="7" height="5" rx="1.5" />
      <rect x="14" y="12" width="7" height="9" rx="1.5" />
      <rect x="3" y="16" width="7" height="5" rx="1.5" />
    </>
  ),
  stats: <path d="M5 20v-7M12 20V4M19 20v-10" />,
  blocklists: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="m5.7 5.7 12.6 12.6" />
    </>
  ),
  schedule: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3.2 2" />
    </>
  ),
  keys: (
    <>
      <circle cx="7.5" cy="15.5" r="4.5" />
      <path d="M10.7 12.3 20 3M16.5 6.5l3 3M13.5 9.5l2 2" />
    </>
  ),
  account: (
    <>
      <circle cx="12" cy="8" r="4" />
      <path d="M4 21a8 8 0 0 1 16 0" />
    </>
  ),
  settings: (
    <>
      <path d="M4 6h9M19 6h1M4 12h2M12 12h8M4 18h11M20 18h0" />
      <circle cx="16" cy="6" r="2.2" />
      <circle cx="9" cy="12" r="2.2" />
      <circle cx="17.5" cy="18" r="2.2" />
    </>
  ),
} satisfies Partial<Record<Route, React.ReactNode>>;

const NAV: { route: keyof typeof NAV_ICONS; label: string }[] = [
  { route: 'dashboard', label: 'Dashboard' },
  { route: 'stats', label: 'Stats' },
  { route: 'blocklists', label: 'Blocklists' },
  { route: 'schedule', label: 'Schedule' },
  { route: 'keys', label: 'Keys' },
  { route: 'account', label: 'Account' },
  { route: 'settings', label: 'Settings' },
];

function NavIcon({ route }: { route: keyof typeof NAV_ICONS }) {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {NAV_ICONS[route]}
    </svg>
  );
}

/** A short label summarizing the sidebar's active policy — mirrors the presets in Blocklists.tsx. */
function policyModeLabel(policy: Policy, aiMode: boolean): string {
  const defaultAction = effectiveAction(policy.defaultAction, policy, aiMode);
  if (defaultAction === 'judge') return 'Smart';
  if (defaultAction === 'block') {
    return SMART_FILTERING_ENABLED &&
      policy.blockedDomains.length === 0 &&
      policy.allowedDomains.length === 0 &&
      Object.keys(policy.sites ?? {}).length === 0
      ? 'Block all'
      : 'Whitelist';
  }
  return 'Blacklist';
}

// Unlike Vite's DEV flag, APP_ENV remains "development" in packaged dev builds too.
const IS_DEV = __APP_CONFIG__.APP_ENV !== 'production';
const SMART_FILTERING_ENABLED = productFeaturesForEnvironment(
  __APP_CONFIG__.APP_ENV,
).smartFiltering;

/** `initialRoute` lets the marketing motion graphics (apps/motion) open a page other than the dashboard. */
export default function App({ initialRoute = 'dashboard' }: { initialRoute?: Route } = {}) {
  const init = useFocusStore((s) => s.init);
  const ready = useFocusStore((s) => s.ready);
  const usingMock = useFocusStore((s) => s.usingMock);
  const keyPresent = useFocusStore((s) => s.keyPresent);
  const focusActive = useFocusStore((s) => s.focusActive);
  const policy = useFocusStore((s) => s.policy);
  const aiMode = useFocusStore((s) => s.aiMode);
  const watchdogWarning = useFocusStore((s) => s.watchdogWarning);
  const clearWatchdogWarning = useFocusStore((s) => s.clearWatchdogWarning);
  const passwordRecovery = useFocusStore((s) => s.passwordRecovery);
  const onboardingComplete = useFocusStore((s) => s.onboardingComplete);
  const overridesOpen = useFocusStore((s) => s.overridesOpen);
  const setOverridesOpen = useFocusStore((s) => s.setOverridesOpen);
  const [route, setRoute] = useState<Route>(initialRoute);

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

  const activeRoute = NAV.find((item) => item.route === route);

  // The walkthrough covers the whole window until it's finished. It needs live service state
  // (drives, paired keys, the active profile), so it waits for the same `ready` gate as the pages.
  const showFirstRun = ready && onboardingComplete === false;

  return (
    <div
      className={cx(
        'desktop-workspace relative mx-auto flex h-full w-full overflow-hidden bg-bg text-slate-200',
        IS_DEV && 'desktop-workspace--dev',
      )}
    >
      {showFirstRun && <FirstRun onDone={() => setRoute('dashboard')} />}
      {ready && overridesOpen && <OverrideDialog onClose={() => setOverridesOpen(false)} />}
      <ArmConfirm />

      {/* Nav rail. */}
      <aside className="desktop-sidebar relative flex w-44 shrink-0 flex-col border-r border-white/[0.07] backdrop-blur-xl">
        <div className="flex items-center gap-2.5 px-[18px] pb-[19px] pt-[19px]">
          <TalysmanMark size={22} className="drop-shadow-[0_0_10px_rgb(var(--color-signal)/0.22)]" />
          <span className="desktop-brand-name">Talysman</span>
          {IS_DEV && (
            <span className="dev-mode-label" aria-label="Development mode">
              Dev
            </span>
          )}
        </div>

        <nav className="flex flex-col gap-1 px-2.5">
          {NAV.map((n) => {
            const on = route === n.route;
            return (
              <button
                key={n.route}
                onClick={() => setRoute(n.route)}
                aria-current={on ? 'page' : undefined}
                className={cx(
                  'desktop-nav-item flex items-center gap-2.5 rounded-[10px] px-[11px] py-[8px] text-left text-body font-medium transition',
                  on ? 'text-white' : 'text-slate-400 hover:bg-white/[0.045] hover:text-slate-100',
                )}
              >
                <NavIcon route={n.route} />
                {n.label}
              </button>
            );
          })}
        </nav>

        <div className="desktop-mode-readout m-2.5 mt-auto flex items-center gap-2.5 px-3 py-2.5">
          <ProfileDot
            color={focusActive ? desktopPaletteColor('signal') : palette.colors.foregroundFaint}
            glow={focusActive}
          />
          <div>
            <div className="font-mono text-caption tracking-[0.14em] text-slate-450">MODE</div>
            <div className="mt-0.5 text-body font-medium text-slate-200">
              {focusActive ? policyModeLabel(policy, aiMode) : 'Off'}
            </div>
          </div>
        </div>
      </aside>

      <div className="desktop-pane relative flex min-w-0 flex-1 flex-col">
        <header className="desktop-header flex h-14 shrink-0 items-center px-5">
          <div className="mx-auto flex w-full max-w-[960px] items-center gap-2.5">
            <div className="flex items-center gap-2.5">
              <span
                aria-hidden="true"
                className="block h-1.5 w-1.5 rounded-full bg-signal shadow-[0_0_10px_rgb(var(--color-signal)/0.6)]"
              />
              <span className="desktop-route-title">{activeRoute?.label}</span>
            </div>
            {usingMock && (
              <span className="font-mono text-caption tracking-[0.14em] text-warn">MOCK SERVICE</span>
            )}

            <button
              onClick={() => setRoute('keys')}
              className={cx(
                'ml-auto flex items-center gap-2 rounded-full border py-1.5 pl-2.5 pr-3 shadow-[inset_0_1px_rgb(var(--color-white)/0.06)] backdrop-blur-sm transition',
                keyPresent
                  ? 'border-ok/30 bg-ok/[0.09] hover:border-ok/45 hover:bg-ok/[0.14]'
                  : 'border-danger/30 bg-danger/[0.10] hover:border-danger/45 hover:bg-danger/[0.16]',
              )}
            >
              <span
                className={cx(
                  'block h-[7px] w-[7px] rounded-full',
                  keyPresent
                    ? 'bg-ok shadow-[0_0_8px_2px_rgb(var(--color-success)/0.6)]'
                    : 'bg-danger shadow-[0_0_8px_2px_rgb(var(--color-danger)/0.55)]',
                )}
              />
              <span
                className={cx(
                  'font-mono text-caption font-medium tracking-[0.12em]',
                  keyPresent ? 'text-okInk' : 'text-dangerInk',
                )}
              >
                {keyPresent ? 'KEY PRESENT' : 'NO KEY'}
              </span>
            </button>
          </div>
        </header>

        {watchdogWarning && (
          <div className="pointer-events-none absolute inset-x-0 top-14 z-50 flex justify-center p-4">
            <div className="pointer-events-auto flex items-center gap-3 rounded-[10px] border border-warn/40 bg-warn/[0.10] px-4 py-2 text-body text-warn backdrop-blur-md">
              <span>
                {watchdogWarning.browser} isn’t proving the Talysman extension is active — it will
                be closed if it stays unprotected.
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

        <AppMessageBanners />

        <main className="min-h-0 flex-1 overflow-y-auto px-5 pb-6">
          {!ready ? (
            <div className="flex h-full items-center justify-center text-slate-500">Connecting…</div>
          ) : (
            <div key={route} className="mx-auto h-full w-full max-w-[960px] animate-rise">
              {route === 'dashboard' && <Dashboard />}
              {route === 'stats' && <Stats />}
              {route === 'blocklists' && <Blocklists onUpgrade={() => setRoute('plans')} />}
              {route === 'schedule' && <SchedulePage onUpgrade={() => setRoute('plans')} />}
              {route === 'keys' && <Keys />}
              {route === 'account' && <Account onUpgrade={() => setRoute('plans')} />}
              {route === 'plans' && <Plans />}
              {route === 'settings' && <Settings />}
            </div>
          )}
        </main>
      </div>
    </div>
  );
}
