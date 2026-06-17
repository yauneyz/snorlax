import React from 'react';
import { Badge, Card, CardTitle } from '../components/ui/index.js';
import { useFocusStore } from '../store/useFocusStore.js';

/** Placeholder until Phase 3 (Supabase auth + Stripe entitlement). */
export function Account() {
  const subscriptionPlan = useFocusStore((s) => s.subscriptionPlan);
  const entitlementActive = useFocusStore((s) => s.entitlementActive);

  return (
    <div className="grid grid-cols-1 gap-6">
      <Card>
        <CardTitle hint="Sign-in and billing land in Phase 3.">Account</CardTitle>
        <div className="flex flex-col gap-2 text-sm text-slate-300">
          <div className="flex items-center gap-2">
            Status: <Badge tone="neutral">not signed in</Badge>
          </div>
          <div className="flex items-center gap-2">
            Plan:{' '}
            <Badge tone={entitlementActive ? 'ok' : 'neutral'}>
              {subscriptionPlan === 'pro' ? 'Pro' : 'Free'}
            </Badge>
          </div>
        </div>
        <p className="mt-3 text-sm text-slate-500">
          Auth (Supabase) and payments (Stripe via a hosted page + edge function) are not wired
          yet. The current build runs without an account so you can test enforcement locally.
        </p>
      </Card>
    </div>
  );
}
