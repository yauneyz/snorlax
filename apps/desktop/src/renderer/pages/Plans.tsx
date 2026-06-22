import React, { useState } from 'react';
import { Badge, Button, Card, CardTitle } from '../components/ui/index.js';
import { useFocusStore } from '../store/useFocusStore.js';
import { startCheckout, type CheckoutPrice } from '../lib/bridge.js';

export function Plans() {
  const subscriptionPlan = useFocusStore((s) => s.subscriptionPlan);
  const appEnv = useFocusStore((s) => s.appEnv);
  const signedIn = useFocusStore((s) => s.signedIn);
  const setDevSubscriptionPlan = useFocusStore((s) => s.setDevSubscriptionPlan);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const isDev = appEnv !== 'production';

  async function devUpgrade() {
    setBusy(true);
    setMessage(null);
    try {
      await setDevSubscriptionPlan('pro');
      setMessage('Pro enabled for development.');
    } catch (e) {
      setMessage((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function checkout(price: CheckoutPrice) {
    setBusy(true);
    setMessage(null);
    try {
      const res = await startCheckout(price);
      if (!res.ok) setMessage(res.message ?? 'Could not start checkout.');
      else setMessage('Opening secure checkout in your browser…');
    } catch (e) {
      setMessage((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
      <Card>
        <div className="mb-4 flex items-center justify-between gap-3">
          <CardTitle hint="Manual blocking with USB-key unlock protection.">Free</CardTitle>
          {subscriptionPlan === 'free' && <Badge tone="neutral">current</Badge>}
        </div>
        <div className="flex flex-col gap-2 text-sm text-slate-300">
          <div>5 blocked websites</div>
          <div>Blacklist mode</div>
          <div>Block-all internet mode</div>
          <div>Manual focus toggle</div>
          <div>USB key required to turn focus off</div>
        </div>
      </Card>

      <Card className="border-accent/60 bg-accent/5">
        <div className="mb-4 flex items-center justify-between gap-3">
          <CardTitle hint="Everything in the app, including future Pro capabilities.">Pro</CardTitle>
          {subscriptionPlan === 'pro' && <Badge tone="ok">current</Badge>}
        </div>
        <div className="mb-5 flex flex-col gap-2 text-sm text-slate-300">
          <div>Unlimited blocked websites</div>
          <div>App blocking</div>
          <div>Scheduling</div>
          <div>Whitelist mode</div>
          <div>All future Pro features by default</div>
        </div>
        {isDev ? (
          <Button onClick={devUpgrade} disabled={busy || subscriptionPlan === 'pro'}>
            Upgrade to Pro (dev)
          </Button>
        ) : (
          <div className="flex flex-wrap gap-2">
            <Button
              onClick={() => checkout('monthly')}
              disabled={busy || subscriptionPlan === 'pro' || !signedIn}
            >
              Upgrade — Monthly
            </Button>
            <Button
              variant="ghost"
              onClick={() => checkout('yearly')}
              disabled={busy || subscriptionPlan === 'pro' || !signedIn}
            >
              Upgrade — Yearly
            </Button>
          </div>
        )}
        {!isDev && !signedIn && (
          <p className="mt-3 text-sm text-slate-400">Sign in on the Account page to upgrade.</p>
        )}
        {message && <p className="mt-3 text-sm text-slate-400">{message}</p>}
      </Card>
    </div>
  );
}
