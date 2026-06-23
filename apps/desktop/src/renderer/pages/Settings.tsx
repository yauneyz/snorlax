import React, { useState } from 'react';
import { useFocusStore } from '../store/useFocusStore.js';
import { devToggleKey, type SubscriptionPlan } from '../lib/bridge.js';
import { Badge, Button, Card, CardTitle } from '../components/ui/index.js';
import { cx } from '../lib/utils.js';

export function Settings() {
  const appEnv = useFocusStore((s) => s.appEnv);
  const usingMock = useFocusStore((s) => s.usingMock);
  const serviceVersion = useFocusStore((s) => s.serviceVersion);
  const entitlementLoaded = useFocusStore((s) => s.entitlementLoaded);
  const subscriptionPlan = useFocusStore((s) => s.subscriptionPlan);
  const entitlementActive = useFocusStore((s) => s.entitlementActive);
  const entitlementSource = useFocusStore((s) => s.entitlementSource);
  const setDevSubscriptionPlan = useFocusStore((s) => s.setDevSubscriptionPlan);
  const handshakeEnabled = useFocusStore((s) => s.settings.browserHandshakeEnabled);
  const keyPresent = useFocusStore((s) => s.keyPresent);
  const setBrowserHandshake = useFocusStore((s) => s.setBrowserHandshake);
  const [planBusy, setPlanBusy] = useState(false);
  const [planError, setPlanError] = useState<string | null>(null);
  const [handshakeBusy, setHandshakeBusy] = useState(false);
  const [handshakeError, setHandshakeError] = useState<string | null>(null);

  const showDeveloper = appEnv !== 'production' || usingMock;

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

  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
      <Card>
        <CardTitle>About</CardTitle>
        <div className="flex flex-col gap-2 text-sm text-slate-300">
          <div>
            Environment: <Badge tone="neutral">{appEnv}</Badge>
          </div>
          <div>
            Service: <Badge tone={usingMock ? 'neutral' : 'ok'}>{usingMock ? 'mock (in-process)' : 'native'}</Badge>
          </div>
          <div>Service version: {serviceVersion}</div>
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
        </div>
      </Card>

      <Card>
        <CardTitle hint="Closes browsers that can't prove the blocking extension is alive during a locked session.">
          Browser handshake
        </CardTitle>
        <div className="flex flex-col gap-3 text-sm text-slate-300">
          <p className="text-slate-400">
            When on, FocusLock closes any supported browser whose extension stops responding — and any
            browser that can’t run the extension — while a locked focus session is active. Turning it
            off requires your paired USB key.
          </p>
          <div className="flex items-center justify-between gap-3">
            <span className="font-medium text-slate-200">
              Dead-man’s switch:{' '}
              <Badge tone={handshakeEnabled ? 'ok' : 'neutral'}>{handshakeEnabled ? 'On' : 'Off'}</Badge>
            </span>
            <Button
              variant={handshakeEnabled ? 'ghost' : 'primary'}
              disabled={handshakeBusy || (handshakeEnabled && !keyPresent)}
              onClick={() => toggleHandshake()}
            >
              {handshakeEnabled ? 'Turn off' : 'Turn on'}
            </Button>
          </div>
          {handshakeEnabled && !keyPresent && (
            <p className="text-xs text-slate-500">Insert your paired USB key to turn this off.</p>
          )}
          {handshakeError && <p className="text-sm text-amber-300">{handshakeError}</p>}
        </div>
      </Card>

      {showDeveloper && (
        <Card>
          <CardTitle hint="Development-only switches for exercising gated app states.">Developer</CardTitle>

          {appEnv !== 'production' && (
            <div className="mb-5">
              <div className="mb-2 flex items-center justify-between gap-3">
                <span className="text-sm font-medium text-slate-200">Account plan</span>
                <span className="text-xs text-slate-500">{entitlementSource}</span>
              </div>
              <div
                role="group"
                aria-label="Development account plan"
                className="inline-grid grid-cols-2 rounded-lg border border-border bg-panel2 p-1"
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
                        'min-w-24 rounded-md px-4 py-2 text-sm font-medium transition disabled:cursor-not-allowed disabled:opacity-60',
                        selected ? 'bg-accent text-white shadow-sm' : 'text-slate-300 hover:bg-[#222c42]',
                      )}
                    >
                      {plan === 'pro' ? 'Pro' : 'Free'}
                    </button>
                  );
                })}
              </div>
              {planError && <p className="mt-2 text-sm text-amber-300">{planError}</p>}
            </div>
          )}

          {usingMock && (
            <div>
              <p className="mb-3 text-sm text-slate-400">
                Simulate plugging/unplugging the paired USB key to test the red/green indicator and
                the key-required disable gate.
              </p>
              <Button variant="ghost" onClick={() => devToggleKey()}>
                Toggle simulated USB key
              </Button>
            </div>
          )}
        </Card>
      )}
    </div>
  );
}
