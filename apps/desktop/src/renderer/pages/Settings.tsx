import React, { useEffect, useState } from 'react';
import { productFeaturesForEnvironment } from '@talysman/product';
import { useFocusStore } from '../store/useFocusStore.js';
import {
  checkForUpdates,
  aiConnectionStatus,
  onAppEvent,
  testAiConnection,
  type AiConnectionStatus,
  devPushUsageTransition,
  devSimulateExtension,
  devToggleKey,
  uninstallService,
  type SubscriptionPlan,
} from '../lib/bridge.js';
import { Badge, Button, Card, CardTitle, Input } from '../components/ui/index.js';
import { EmergencyConfirm } from '../components/EmergencyConfirm.js';
import { cx } from '../lib/utils.js';

const SMART_FILTERING_ENABLED = productFeaturesForEnvironment(
  __APP_CONFIG__.APP_ENV,
).smartFiltering;

export function Settings() {
  const appEnv = useFocusStore((s) => s.appEnv);
  const appVersion = useFocusStore((s) => s.appVersion);
  const isLocalRelease = useFocusStore((s) => s.isLocalRelease);
  const localEntitlementEnabled = useFocusStore((s) => s.localEntitlementEnabled);
  const usingMock = useFocusStore((s) => s.usingMock);
  const serviceVersion = useFocusStore((s) => s.serviceVersion);
  const entitlementLoaded = useFocusStore((s) => s.entitlementLoaded);
  const subscriptionPlan = useFocusStore((s) => s.subscriptionPlan);
  const entitlementActive = useFocusStore((s) => s.entitlementActive);
  const entitlementSource = useFocusStore((s) => s.entitlementSource);
  const setDevSubscriptionPlan = useFocusStore((s) => s.setDevSubscriptionPlan);
  const setLocalEntitlementEnabled = useFocusStore((s) => s.setLocalEntitlementEnabled);
  const handshakeEnabled = useFocusStore((s) => s.settings.browserHandshakeEnabled);
  const softBlocksRequireHandshake = useFocusStore((s) => Object.keys(s.policy.sites ?? {}).length > 0);
  const keyPresent = useFocusStore((s) => s.keyPresent);
  const setBrowserHandshake = useFocusStore((s) => s.setBrowserHandshake);
  const trayIconEnabled = useFocusStore((s) => s.settings.trayIconEnabled);
  const setTrayIconEnabled = useFocusStore((s) => s.setTrayIconEnabled);
  const streakBadgeEnabled = useFocusStore((s) => s.settings.streakBadgeEnabled);
  const setStreakBadgeEnabled = useFocusStore((s) => s.setStreakBadgeEnabled);
  const aiMode = useFocusStore((s) => s.aiMode);
  const setAiMode = useFocusStore((s) => s.setAiMode);
  const replayOnboarding = useFocusStore((s) => s.replayOnboarding);
  const platform = useFocusStore((s) => s.platform);
  const emergencyLeft = useFocusStore((s) => s.engine.emergencyLeft);
  const [emergencyOpen, setEmergencyOpen] = useState(false);
  const [firstRunError, setFirstRunError] = useState<string | null>(null);
  const [confirmingUninstall, setConfirmingUninstall] = useState(false);
  const [uninstallBusy, setUninstallBusy] = useState(false);
  const [uninstallDone, setUninstallDone] = useState(false);
  const [uninstallError, setUninstallError] = useState<string | null>(null);
  const [planBusy, setPlanBusy] = useState(false);
  const [planError, setPlanError] = useState<string | null>(null);
  const [localEntitlementBusy, setLocalEntitlementBusy] = useState(false);
  const [localEntitlementError, setLocalEntitlementError] = useState<string | null>(null);
  const [handshakeBusy, setHandshakeBusy] = useState(false);
  const [handshakeError, setHandshakeError] = useState<string | null>(null);
  const [streakBusy, setStreakBusy] = useState(false);
  const [streakError, setStreakError] = useState<string | null>(null);
  const [trayBusy, setTrayBusy] = useState(false);
  const [trayError, setTrayError] = useState<string | null>(null);
  const [aiModeBusy, setAiModeBusy] = useState(false);
  const [aiModeError, setAiModeError] = useState<string | null>(null);
  const [aiConnection, setAiConnection] = useState<AiConnectionStatus | null>(null);
  const [connectionExpanded, setConnectionExpanded] = useState(false);
  const [connectionBusy, setConnectionBusy] = useState(false);
  const [aiUrl, setAiUrl] = useState('');
  const [aiModel, setAiModel] = useState('');
  const [aiKey, setAiKey] = useState('');
  const [aiHeaders, setAiHeaders] = useState('');
  const [clearAiKey, setClearAiKey] = useState(false);
  const [clearAiHeaders, setClearAiHeaders] = useState(false);
  const [updateBusy, setUpdateBusy] = useState(false);
  const [updateStatus, setUpdateStatus] = useState<{
    message: string;
    error?: boolean;
  } | null>(null);
  const showDeveloper = appEnv !== 'production' || usingMock;

  useEffect(() => {
    if (!SMART_FILTERING_ENABLED) return;
    let active = true;
    void aiConnectionStatus().then((status) => {
      if (!active) return;
      setAiConnection(status);
      setAiUrl(status.url);
      setAiModel(status.model);
    });
    const unsubscribe = onAppEvent((event) => {
      if (event === 'aiConnectionChanged') {
        void aiConnectionStatus().then((status) => { if (active) setAiConnection(status); });
      }
    });
    return () => { active = false; unsubscribe(); };
  }, []);

  async function runUninstall() {
    setConfirmingUninstall(false);
    setUninstallBusy(true);
    setUninstallError(null);
    try {
      const res = await uninstallService();
      if (res.ok) {
        setUninstallDone(true);
      } else {
        setUninstallError(res.message);
      }
    } catch (e) {
      setUninstallError((e as Error).message);
    } finally {
      setUninstallBusy(false);
    }
  }

  async function choosePlan(plan: SubscriptionPlan) {
    setPlanBusy(true);
    setPlanError(null);
    try {
      await setDevSubscriptionPlan(plan);
    } catch (e) {
      setPlanError((e as Error).message);
    } finally {
      setPlanBusy(false);
    }
  }

  async function toggleHandshake() {
    setHandshakeBusy(true);
    setHandshakeError(null);
    try {
      await setBrowserHandshake(!handshakeEnabled);
    } catch (e) {
      const code = (e as { code?: string }).code;
      if (code === 'KEY_REQUIRED') {
        setHandshakeError('Insert your paired USB key to turn this off.');
      } else if (code === 'LOCKED') {
        setHandshakeError('Locked by your schedule — this can’t be turned off right now.');
      } else {
        setHandshakeError((e as Error).message);
      }
    } finally {
      setHandshakeBusy(false);
    }
  }

  async function toggleTrayIcon() {
    setTrayBusy(true);
    setTrayError(null);
    try {
      await setTrayIconEnabled(!trayIconEnabled);
    } catch (e) {
      setTrayError((e as Error).message);
    } finally {
      setTrayBusy(false);
    }
  }

  async function toggleStreakBadge() {
    setStreakBusy(true);
    setStreakError(null);
    try {
      await setStreakBadgeEnabled(!streakBadgeEnabled);
    } catch (e) {
      setStreakError((e as Error).message);
    } finally {
      setStreakBusy(false);
    }
  }

  async function toggleAiMode() {
    if (!aiMode && !aiConnection?.healthy) {
      setConnectionExpanded(true);
      return;
    }
    setAiModeBusy(true);
    setAiModeError(null);
    try {
      await setAiMode(!aiMode);
    } catch (e) {
      setAiModeError((e as Error).message);
    } finally {
      setAiModeBusy(false);
    }
  }

  async function runAiConnectionTest() {
    setConnectionBusy(true);
    setAiModeError(null);
    try {
      const status = await testAiConnection({
        url: aiUrl,
        model: aiModel,
        apiKey: aiKey,
        extraHeaders: aiHeaders,
        clearApiKey: clearAiKey,
        clearExtraHeaders: clearAiHeaders,
      });
      setAiConnection(status);
      setAiKey('');
      setAiHeaders('');
      setClearAiKey(false);
      setClearAiHeaders(false);
    } catch (e) {
      setAiModeError((e as Error).message);
    } finally {
      setConnectionBusy(false);
    }
  }

  async function toggleLocalEntitlement() {
    setLocalEntitlementBusy(true);
    setLocalEntitlementError(null);
    try {
      await setLocalEntitlementEnabled(!localEntitlementEnabled);
    } catch (e) {
      setLocalEntitlementError((e as Error).message);
    } finally {
      setLocalEntitlementBusy(false);
    }
  }

  async function runUpdateCheck() {
    setUpdateBusy(true);
    setUpdateStatus(null);
    try {
      const result = await checkForUpdates();
      if (result.status === 'up-to-date') {
        setUpdateStatus({ message: `Talysman ${result.version} is up to date.` });
      } else if (result.status === 'update-available') {
        setUpdateStatus({
          message: `Talysman ${result.version} is available and is being downloaded.`,
        });
      } else {
        setUpdateStatus({ message: result.message, error: result.status === 'error' });
      }
    } catch (e) {
      setUpdateStatus({ message: (e as Error).message, error: true });
    } finally {
      setUpdateBusy(false);
    }
  }

  return (
    <div className="grid grid-cols-1 gap-3 py-3 lg:grid-cols-2">
      <Card>
        <CardTitle>About</CardTitle>
        <div className="flex flex-col gap-2 text-body text-slate-300">
          <div>
            Environment: <Badge tone="neutral">{appEnv}</Badge>
          </div>
          <div>
            Service: <Badge tone={usingMock ? 'neutral' : 'ok'}>{usingMock ? 'mock (in-process)' : 'native'}</Badge>
          </div>
          <div>Service version: {serviceVersion}</div>
          <div>Client version: {appVersion}</div>
          <div>
            Plan:{' '}
            {entitlementLoaded ? (
              <Badge tone={entitlementActive ? 'ok' : 'neutral'}>
                {subscriptionPlan === 'pro' ? 'Pro' : 'Free'}
              </Badge>
            ) : (
              <Badge tone="neutral">Checking…</Badge>
            )}
          </div>
          <div className="mt-2 flex flex-col items-start gap-2 border-t border-white/[0.07] pt-4">
            <Button variant="ghost" disabled={updateBusy} onClick={() => runUpdateCheck()}>
              {updateBusy ? 'Checking…' : 'Check for updates'}
            </Button>
            {updateStatus && (
              <p
                role="status"
                className={updateStatus.error ? 'text-body text-warn' : 'text-body text-slate-400'}
              >
                {updateStatus.message}
              </p>
            )}
          </div>
        </div>
      </Card>

      {isLocalRelease && (
        <Card>
          <CardTitle hint="Only available in builds produced by pnpm release:local.">
            Local release testing
          </CardTitle>
          <div className="flex flex-col gap-3 text-body text-slate-300">
            <p className="text-slate-400">
              Temporarily bypass the free local Pro entitlement to test the plan your signed-in
              account would normally receive. Local Pro turns back on when Talysman restarts.
            </p>
            <div className="flex items-center justify-between gap-3">
              <span className="font-medium text-slate-200">
                Free local Pro:{' '}
                <Badge tone={localEntitlementEnabled ? 'ok' : 'neutral'}>
                  {localEntitlementEnabled ? 'On' : 'Off'}
                </Badge>
              </span>
              <Button
                variant={localEntitlementEnabled ? 'ghost' : 'primary'}
                disabled={localEntitlementBusy || !entitlementLoaded}
                onClick={() => toggleLocalEntitlement()}
              >
                {localEntitlementEnabled ? 'Temporarily disable' : 'Re-enable free Pro'}
              </Button>
            </div>
            {localEntitlementError && (
              <p className="text-body text-warn">{localEntitlementError}</p>
            )}
          </div>
        </Card>
      )}

      <Card>
        <CardTitle>Strict Mode</CardTitle>
        <div className="flex flex-col gap-3 text-body text-slate-300">
          <p className="text-slate-400">
            Strict Mode prevents you from just removing/disabling the Talysman extension or using a
            browser where the extension isn’t supported.
          </p>
          <p className="text-slate-400">
            When Strict Mode and focus mode are both turned on, Talysman will automatically close any
            browser where it doesn’t detect the Talysman browser extension as being enabled.
          </p>
          <p className="text-slate-400">You can only turn off Strict Mode using your paired USB key.</p>
          {softBlocksRequireHandshake && (
            <p className="text-slate-400">Strict Mode stays on while the active profile has site rules.</p>
          )}
          <div className="flex items-center justify-between gap-3">
            <span className="font-medium text-slate-200">
              Status:{' '}
              <Badge tone={handshakeEnabled || softBlocksRequireHandshake ? 'ok' : 'neutral'}>
                {handshakeEnabled || softBlocksRequireHandshake ? 'On' : 'Off'}
              </Badge>
            </span>
            <Button
              variant={handshakeEnabled ? 'ghost' : 'primary'}
              disabled={handshakeBusy || softBlocksRequireHandshake || (handshakeEnabled && !keyPresent)}
              onClick={() => toggleHandshake()}
            >
              {softBlocksRequireHandshake ? 'Required' : handshakeEnabled ? 'Turn off' : 'Turn on'}
            </Button>
          </div>
          {handshakeEnabled && !keyPresent && (
            <p className="text-caption text-slate-500">Insert your paired USB key to turn this off.</p>
          )}
          {handshakeError && <p className="text-body text-warn">{handshakeError}</p>}
        </div>
      </Card>

      <Card>
        <CardTitle hint="A small standalone helper (not this app) shows blocking status in your system tray.">
          Talysman System Tray Icon
        </CardTitle>
        <div className="flex flex-col gap-3 text-body text-slate-300">
          <div className="flex items-center justify-between gap-3">
            <span className="font-medium text-slate-200">
              Status: <Badge tone={trayIconEnabled ? 'ok' : 'neutral'}>{trayIconEnabled ? 'On' : 'Off'}</Badge>
            </span>
            <Button
              variant={trayIconEnabled ? 'ghost' : 'primary'}
              disabled={trayBusy}
              onClick={() => toggleTrayIcon()}
            >
              {trayIconEnabled ? 'Turn off' : 'Turn on'}
            </Button>
          </div>
          {trayError && <p className="text-body text-warn">{trayError}</p>}
        </div>
      </Card>

      <Card>
        <CardTitle hint="Your streak is still recorded while the badge is hidden.">Streak counter</CardTitle>
        <div className="flex flex-col gap-3 text-body text-slate-300">
          <div className="flex items-center justify-between gap-3">
            <span className="font-medium text-slate-100">
              Status: <Badge tone={streakBadgeEnabled ? 'ok' : 'neutral'}>{streakBadgeEnabled ? 'Shown' : 'Hidden'}</Badge>
            </span>
            <Button
              variant={streakBadgeEnabled ? 'ghost' : 'primary'}
              disabled={streakBusy}
              onClick={() => toggleStreakBadge()}
            >
              {streakBadgeEnabled ? 'Hide' : 'Show'}
            </Button>
          </div>
          {streakError && <p className="text-body text-warn">{streakError}</p>}
        </div>
      </Card>

      {SMART_FILTERING_ENABLED && (
        <Card>
          <CardTitle hint="Optional. Everything else in Talysman works the same with it off.">
            AI mode
          </CardTitle>
          <div className="flex flex-col gap-3 text-body text-slate-300">
            <p className="text-slate-400">
              Adds AI filtering to your blocklists: pages or site features you set to “AI” are
              checked against what you’re working on. While it’s off, AI rules are hidden and
              nothing is sent for checking.
            </p>
            <div className="flex items-center justify-between gap-3">
              <span className="font-medium text-slate-200">
                Status: <Badge tone={aiMode ? aiConnection?.healthy ? 'ok' : 'danger' : 'neutral'}>
                  {aiMode ? aiConnection?.healthy ? 'On' : 'On, waiting for connection' : 'Off'}
                </Badge>
              </span>
              <Button
                variant={aiMode ? 'ghost' : 'primary'}
                disabled={aiModeBusy}
                onClick={() => toggleAiMode()}
              >
                {aiMode ? 'Turn off' : 'Turn on'}
              </Button>
            </div>
            <div className="flex items-center justify-between gap-3 rounded-lg border border-white/[0.08] bg-white/[0.025] px-3 py-2">
              <span className="flex items-center gap-2 text-body">
                <span aria-label={aiConnection?.healthy ? 'Connection working' : 'Connection needs attention'}
                  className={cx('h-2.5 w-2.5 rounded-full', aiConnection?.healthy ? 'bg-ok shadow-[0_0_8px_rgb(var(--color-success)/0.6)]' : 'bg-danger shadow-[0_0_8px_rgb(var(--color-danger)/0.55)]')} />
                {aiConnection?.healthy ? 'AI connection working' : 'AI connection needs a successful test'}
              </span>
              <Button variant="ghost" onClick={() => setConnectionExpanded(!connectionExpanded)}>
                {connectionExpanded ? 'Hide setup' : 'Connection setup'}
              </Button>
            </div>
            {aiConnection?.error && <p className="text-body text-dangerInk">{aiConnection.error}</p>}
            {connectionExpanded && (
              <div className="flex flex-col gap-3 rounded-lg border border-white/[0.08] p-3">
                {aiConnection?.localPreset && <p className="text-caption text-slate-400">Local preset: llm-serve at 127.0.0.1:11434. Model auto discovers the active target.</p>}
                <label className="text-caption text-slate-300">OpenAI compatible URL
                  <Input value={aiUrl} onChange={(e) => setAiUrl(e.target.value)} placeholder="https://api.openai.com/v1" className="mt-1" />
                </label>
                <label className="text-caption text-slate-300">Model ID
                  <Input value={aiModel} onChange={(e) => setAiModel(e.target.value)} placeholder="Model ID or auto" className="mt-1" />
                </label>
                <label className="text-caption text-slate-300">API key (optional)
                  <Input type="password" value={aiKey} onChange={(e) => setAiKey(e.target.value)} placeholder={aiConnection?.hasApiKey ? 'Saved key (leave blank to keep)' : 'Bearer token'} className="mt-1" autoComplete="off" />
                </label>
                {aiConnection?.hasApiKey && <label className="flex items-center gap-2 text-caption text-slate-400"><input type="checkbox" checked={clearAiKey} onChange={(e) => setClearAiKey(e.target.checked)} />Remove saved key</label>}
                <label className="text-caption text-slate-300">Extra headers (optional JSON)
                  <Input value={aiHeaders} onChange={(e) => setAiHeaders(e.target.value)} placeholder={aiConnection?.hasExtraHeaders ? 'Saved headers (leave blank to keep)' : '{"Header-Name":"value"}'} className="mt-1" autoComplete="off" />
                </label>
                {aiConnection?.hasExtraHeaders && <label className="flex items-center gap-2 text-caption text-slate-400"><input type="checkbox" checked={clearAiHeaders} onChange={(e) => setClearAiHeaders(e.target.checked)} />Remove saved headers</label>}
                <p className="text-caption text-slate-400">Testing sends a short prompt to this endpoint. Once connected, pages set to AI are sent there for judgment.</p>
                <div><Button disabled={connectionBusy || !aiUrl.trim() || !aiModel.trim()} onClick={() => void runAiConnectionTest()}>{connectionBusy ? 'Testing…' : 'Test connection'}</Button></div>
              </div>
            )}
            {aiModeError && <p className="text-body text-warn">{aiModeError}</p>}
          </div>
        </Card>
      )}

      <Card>
        <CardTitle hint="Keyless, five per device for life. Use it when your key is lost or broken.">
          Emergency unlock
        </CardTitle>
        <div className="flex flex-col gap-3 text-body text-slate-300">
          <p className="text-slate-400">
            Turns everything off — even locked windows — until you or a schedule turn it back on. Resets your
            streak. You can never get an emergency unlock back.
          </p>
          <div className="flex items-center justify-between gap-3">
            <span className="font-medium text-slate-200">
              Left: <Badge tone={emergencyLeft === 0 ? 'danger' : 'neutral'}>{emergencyLeft}</Badge>
            </span>
            <Button variant="danger" disabled={emergencyLeft === 0} onClick={() => setEmergencyOpen(true)}>
              Use emergency unlock…
            </Button>
          </div>
        </div>
      </Card>
      {emergencyOpen && <EmergencyConfirm onClose={() => setEmergencyOpen(false)} />}

      {platform === 'darwin' && (
        <Card>
          <CardTitle hint="Dragging Talysman to the Trash does not do this — the background service lives outside the app bundle.">
            Uninstall
          </CardTitle>
          <div className="flex flex-col gap-3 text-body text-slate-300">
            {uninstallDone ? (
              <p className="text-slate-300">
                The background service and its enforcement have been removed. You can now delete
                Talysman from Applications.
              </p>
            ) : (
              <>
                <p className="text-slate-400">
                  Stops and removes the privileged background service, its LaunchDaemon, and any
                  active network blocking. This does not delete Talysman.app itself — do that
                  afterward from Applications.
                </p>
                <div className="flex flex-wrap items-center gap-2">
                  {confirmingUninstall ? (
                    <>
                      <Button
                        variant="danger"
                        disabled={uninstallBusy}
                        onClick={() => runUninstall()}
                      >
                        {uninstallBusy ? 'Removing…' : 'Confirm uninstall'}
                      </Button>
                      <Button
                        variant="ghost"
                        disabled={uninstallBusy}
                        onClick={() => setConfirmingUninstall(false)}
                      >
                        Cancel
                      </Button>
                    </>
                  ) : (
                    <Button variant="danger" onClick={() => setConfirmingUninstall(true)}>
                      Uninstall Talysman…
                    </Button>
                  )}
                </div>
                {uninstallError && <p className="text-body text-warn">{uninstallError}</p>}
              </>
            )}
          </div>
        </Card>
      )}

      {showDeveloper && (
        <Card>
          <CardTitle hint="Development-only switches for exercising gated app states.">Developer</CardTitle>

          {appEnv !== 'production' && (
            <div className="mb-5">
              <div className="mb-2 flex items-center justify-between gap-3">
                <span className="text-body font-medium text-slate-200">Account plan</span>
                <span className="text-caption text-slate-500">{entitlementSource}</span>
              </div>
              <div
                role="group"
                aria-label="Development account plan"
                className="inline-grid grid-cols-2 rounded-full border border-white/[0.07] bg-white/[0.05] p-[3px]"
              >
                {(['free', 'pro'] as const).map((plan) => {
                  const selected = subscriptionPlan === plan;
                  return (
                    <button
                      key={plan}
                      type="button"
                      aria-pressed={selected}
                      disabled={planBusy}
                      onClick={() => choosePlan(plan)}
                      className={cx(
                        'min-w-24 rounded-full px-4 py-1.5 text-body font-medium transition disabled:cursor-not-allowed disabled:opacity-60',
                        selected
                          ? 'bg-white/[0.10] text-white'
                          : 'text-slate-400 hover:bg-white/[0.05] hover:text-slate-200',
                      )}
                    >
                      {plan === 'pro' ? 'Pro' : 'Free'}
                    </button>
                  );
                })}
              </div>
              {planError && <p className="mt-2 text-body text-warn">{planError}</p>}
            </div>
          )}

          {usingMock && (
            <div className="mb-5">
              <p className="mb-3 text-body text-slate-400">
                Simulate plugging/unplugging the paired USB key to test the red/green indicator and
                the key-required disable gate, or fake one browser-extension heartbeat — the real
                native-messaging host can’t reach the in-process mock.
              </p>
              <div className="flex flex-wrap gap-2">
                <Button variant="ghost" onClick={() => devToggleKey()}>
                  Toggle simulated USB key
                </Button>
                <Button variant="ghost" onClick={() => devSimulateExtension()}>
                  Simulate extension heartbeat
                </Button>
                <Button
                  variant="ghost"
                  onClick={() => {
                    void devPushUsageTransition('focusOn');
                  }}
                >
                  Push fake focus-on transition
                </Button>
                <Button
                  variant="ghost"
                  onClick={() => {
                    void devPushUsageTransition('focusOff');
                  }}
                >
                  Push fake focus-off transition
                </Button>
              </div>
            </div>
          )}

          <div>
            <p className="mb-3 text-body text-slate-400">
              Clear the first-run flag and reopen the setup walkthrough. This only affects what the
              app shows you — profiles, keys and enforcement state are left alone.
            </p>
            <Button
              variant="ghost"
              onClick={() => {
                setFirstRunError(null);
                replayOnboarding().catch((e) => setFirstRunError((e as Error).message));
              }}
            >
              Replay first run
            </Button>
            {firstRunError && <p className="mt-2 text-body text-warn">{firstRunError}</p>}
          </div>
        </Card>
      )}
    </div>
  );
}
