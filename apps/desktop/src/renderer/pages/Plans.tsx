import React, { useState } from 'react';
import { Badge, Button, Card, CardTitle } from '../components/ui/index.js';
import { useFocusStore } from '../store/useFocusStore.js';

export function Plans() {
  const subscriptionPlan = useFocusStore((s) => s.subscriptionPlan);
  const setDevSubscriptionPlan = useFocusStore((s) => s.setDevSubscriptionPlan);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function upgrade() {
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
        <Button onClick={upgrade} disabled={busy || subscriptionPlan === 'pro'}>
          Upgrade to Pro
        </Button>
        {message && <p className="mt-3 text-sm text-slate-400">{message}</p>}
      </Card>
    </div>
  );
}
