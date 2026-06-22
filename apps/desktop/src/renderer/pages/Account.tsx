import React, { useState } from 'react';
import { Badge, Button, Card, CardTitle, Input } from '../components/ui/index.js';
import { useFocusStore } from '../store/useFocusStore.js';
import { openBillingPortal, signInGoogle, signInPassword, signOut } from '../lib/bridge.js';

export function Account() {
  const signedIn = useFocusStore((s) => s.signedIn);
  const email = useFocusStore((s) => s.email);
  const subscriptionPlan = useFocusStore((s) => s.subscriptionPlan);
  const entitlementActive = useFocusStore((s) => s.entitlementActive);

  const [formEmail, setFormEmail] = useState('');
  const [formPassword, setFormPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function run(action: () => Promise<{ ok: boolean; message?: string }>) {
    setBusy(true);
    setMessage(null);
    try {
      const res = await action();
      if (!res.ok) setMessage(res.message ?? 'Something went wrong.');
    } catch (e) {
      setMessage((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function emailSignIn(e: React.FormEvent) {
    e.preventDefault();
    await run(() => signInPassword(formEmail, formPassword));
  }

  return (
    <div className="grid grid-cols-1 gap-6">
      <Card>
        <CardTitle hint="Sign in to sync your subscription across devices.">Account</CardTitle>
        <div className="flex flex-col gap-2 text-sm text-slate-300">
          <div className="flex items-center gap-2">
            Status:{' '}
            <Badge tone={signedIn ? 'ok' : 'neutral'}>
              {signedIn ? (email ?? 'signed in') : 'not signed in'}
            </Badge>
          </div>
          <div className="flex items-center gap-2">
            Plan:{' '}
            <Badge tone={entitlementActive ? 'ok' : 'neutral'}>
              {subscriptionPlan === 'pro' ? 'Pro' : 'Free'}
            </Badge>
          </div>
        </div>

        {signedIn ? (
          <div className="mt-4 flex flex-wrap gap-2">
            <Button
              variant="ghost"
              disabled={busy}
              onClick={() => run(() => openBillingPortal())}
            >
              Manage billing
            </Button>
            <Button variant="ghost" disabled={busy} onClick={() => run(() => signOut())}>
              Sign out
            </Button>
          </div>
        ) : (
          <div className="mt-4 flex flex-col gap-4">
            <Button disabled={busy} onClick={() => run(() => signInGoogle())}>
              Sign in with Google
            </Button>
            <div className="text-center text-xs uppercase tracking-wide text-slate-500">or</div>
            <form className="flex flex-col gap-2" onSubmit={emailSignIn}>
              <Input
                type="email"
                placeholder="you@example.com"
                value={formEmail}
                onChange={(e) => setFormEmail(e.target.value)}
                autoComplete="email"
                required
              />
              <Input
                type="password"
                placeholder="Password"
                value={formPassword}
                onChange={(e) => setFormPassword(e.target.value)}
                autoComplete="current-password"
                required
              />
              <Button type="submit" variant="ghost" disabled={busy}>
                Sign in with email
              </Button>
            </form>
          </div>
        )}

        {message && <p className="mt-3 text-sm text-amber-300">{message}</p>}
      </Card>
    </div>
  );
}
