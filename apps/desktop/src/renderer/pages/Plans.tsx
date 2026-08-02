import React, { useState } from 'react';
import { FREE_BLOCKED_SITE_LIMIT } from '@talysman/product';
import { Badge, Button, Card, CardTitle } from '../components/ui/index.js';
import { useFocusStore } from '../store/useFocusStore.js';
import { startCheckout, type CheckoutPrice } from '../lib/bridge.js';

/** Feature line with the teal tick the design uses for anything "included". */
function Feature({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex items-baseline gap-2.5 text-[12.5px] text-slate-250">
      <span className="font-mono text-[10px] text-sealInk">✓</span>
      {children}
    </div>
  );
}

export function Plans() {
  const subscriptionPlan = useFocusStore((s) => s.subscriptionPlan);
  const entitlementLoaded = useFocusStore((s) => s.entitlementLoaded);
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
    <div className="grid grid-cols-1 gap-3 py-3 xl:grid-cols-2">
      <Card>
        <div className="mb-4 flex items-center justify-between gap-3">
          <CardTitle hint="Manual blocking with USB-key unlock protection.">Free</CardTitle>
          {entitlementLoaded && subscriptionPlan === 'free' && <Badge tone="neutral">current</Badge>}
        </div>
        <div className="flex flex-col gap-2">
          <Feature>{FREE_BLOCKED_SITE_LIMIT} blocked websites</Feature>
          <Feature>Unlimited websites in whitelist mode</Feature>
          <Feature>One blocking profile</Feature>
          <Feature>Block-all internet mode</Feature>
          <Feature>Manual focus toggle</Feature>
          <Feature>USB key required to turn focus off</Feature>
        </div>
      </Card>

      <Card className="border-seal/22 bg-gradient-to-br from-seal/[0.09] to-white/[0.015]">
        <div className="mb-4 flex items-center justify-between gap-3">
          <CardTitle hint="Everything in the app, including future Pro capabilities.">Pro</CardTitle>
          {entitlementLoaded && subscriptionPlan === 'pro' && <Badge tone="ok">current</Badge>}
        </div>
        <div className="mb-5 flex flex-col gap-2">
          <Feature>Unlimited blocked websites</Feature>
          <Feature>Unlimited blocking profiles</Feature>
          <Feature>App blocking</Feature>
          <Feature>Scheduling, profile by profile</Feature>
          <Feature>All future Pro features by default</Feature>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            onClick={() => checkout('monthly')}
            disabled={busy || !entitlementLoaded || subscriptionPlan === 'pro' || !signedIn}
          >
            Upgrade — Monthly
          </Button>
          <Button
            variant="ghost"
            onClick={() => checkout('yearly')}
            disabled={busy || !entitlementLoaded || subscriptionPlan === 'pro' || !signedIn}
          >
            Upgrade — Yearly
          </Button>
        </div>
        {!signedIn && (
          <p className="mt-3 text-sm text-slate-400">Sign in on the Account page to upgrade.</p>
        )}
        {/* Dev builds keep the real checkout above so the payment rails and signup flow stay
            exercisable; this shortcut is the escape hatch for when you just need Pro on. */}
        {isDev && (
          <div className="mt-5 border-t border-white/10 pt-4">
            <Button
              variant="ghost"
              onClick={devUpgrade}
              disabled={busy || !entitlementLoaded || subscriptionPlan === 'pro'}
            >
              Force Pro (dev)
            </Button>
            <p className="mt-2 text-xs text-slate-500">
              Flips the local entitlement without touching Stripe.
            </p>
          </div>
        )}
        {message && <p className="mt-3 text-sm text-slate-400">{message}</p>}
      </Card>
    </div>
  );
}
