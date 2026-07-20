import React, { useState } from 'react';
import { Badge, Button, Card, CardTitle, Input } from '../components/ui/index.js';
import { useFocusStore } from '../store/useFocusStore.js';
import {
  cancelSubscription,
  openBillingPortal,
  resumeSubscription,
  sendPasswordReset,
  signInGoogle,
  signInPassword,
  signOut,
  signUpPassword,
  updatePassword,
} from '../lib/bridge.js';

type AuthView = 'signin' | 'signup' | 'forgot' | 'checkEmail';

const MIN_PASSWORD_LENGTH = 8;

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });
}

function AuthLink({ onClick, children }: { onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="text-xs text-slate-400 underline underline-offset-2 hover:text-slate-200"
    >
      {children}
    </button>
  );
}

export function Account() {
  const signedIn = useFocusStore((s) => s.signedIn);
  const email = useFocusStore((s) => s.email);
  const passwordRecovery = useFocusStore((s) => s.passwordRecovery);
  const entitlementLoaded = useFocusStore((s) => s.entitlementLoaded);
  const subscriptionPlan = useFocusStore((s) => s.subscriptionPlan);
  const entitlementActive = useFocusStore((s) => s.entitlementActive);
  const subscriptionDetail = useFocusStore((s) => s.subscriptionDetail);
  const refreshSubscriptionDetail = useFocusStore((s) => s.refreshSubscriptionDetail);

  const [view, setView] = useState<AuthView>('signin');
  const [formName, setFormName] = useState('');
  const [formEmail, setFormEmail] = useState('');
  const [formPassword, setFormPassword] = useState('');
  const [formConfirm, setFormConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [confirmingCancel, setConfirmingCancel] = useState(false);

  function switchView(next: AuthView) {
    setView(next);
    setMessage(null);
    setNotice(null);
    setFormPassword('');
    setFormConfirm('');
  }

  async function run(action: () => Promise<{ ok: boolean; message?: string }>) {
    setBusy(true);
    setMessage(null);
    try {
      const res = await action();
      if (!res.ok) setMessage(res.message ?? 'Something went wrong.');
      return res.ok;
    } catch (e) {
      setMessage((e as Error).message);
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function emailSignIn(e: React.FormEvent) {
    e.preventDefault();
    await run(() => signInPassword(formEmail, formPassword));
  }

  async function emailSignUp(e: React.FormEvent) {
    e.preventDefault();
    if (formPassword.length < MIN_PASSWORD_LENGTH) {
      setMessage(`Password must be at least ${MIN_PASSWORD_LENGTH} characters.`);
      return;
    }
    setBusy(true);
    setMessage(null);
    try {
      const res = await signUpPassword(formEmail, formPassword, formName || undefined);
      if (!res.ok) {
        setMessage(res.message ?? 'Something went wrong.');
      } else if (res.confirmEmail) {
        setView('checkEmail');
      }
      // Instant-session sign-up needs nothing else: authChanged flips the store to signed in.
    } finally {
      setBusy(false);
    }
  }

  async function requestReset(e: React.FormEvent) {
    e.preventDefault();
    const ok = await run(() => sendPasswordReset(formEmail));
    if (ok) setNotice('If an account exists for that email, we sent a reset link.');
  }

  async function submitNewPassword(e: React.FormEvent) {
    e.preventDefault();
    if (formPassword.length < MIN_PASSWORD_LENGTH) {
      setMessage(`Password must be at least ${MIN_PASSWORD_LENGTH} characters.`);
      return;
    }
    if (formPassword !== formConfirm) {
      setMessage('Passwords do not match.');
      return;
    }
    const ok = await run(() => updatePassword(formPassword));
    if (ok) {
      setFormPassword('');
      setFormConfirm('');
      switchView('signin');
    }
  }

  async function cancelOrResume(action: () => Promise<{ ok: boolean; message?: string }>) {
    setConfirmingCancel(false);
    const ok = await run(action);
    if (!ok) void refreshSubscriptionDetail();
  }

  // A recovery deep link established a session that's waiting on a new password; this takes
  // priority over everything else on the page.
  if (passwordRecovery) {
    return (
      <div className="grid grid-cols-1 gap-6">
        <Card>
          <CardTitle hint="You followed a password-reset link. Pick a new password to finish.">
            Choose a new password
          </CardTitle>
          <form className="mt-4 flex max-w-sm flex-col gap-2" onSubmit={submitNewPassword}>
            <Input
              type="password"
              placeholder="New password"
              value={formPassword}
              onChange={(e) => setFormPassword(e.target.value)}
              autoComplete="new-password"
              minLength={MIN_PASSWORD_LENGTH}
              required
            />
            <Input
              type="password"
              placeholder="Confirm new password"
              value={formConfirm}
              onChange={(e) => setFormConfirm(e.target.value)}
              autoComplete="new-password"
              minLength={MIN_PASSWORD_LENGTH}
              required
            />
            <Button type="submit" disabled={busy}>
              Save new password
            </Button>
          </form>
          {message && <p className="mt-3 text-sm text-amber-300">{message}</p>}
        </Card>
      </div>
    );
  }

  const detail = subscriptionDetail;

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
            {entitlementLoaded ? (
              <Badge tone={entitlementActive ? 'ok' : 'neutral'}>
                {subscriptionPlan === 'pro' ? 'Pro' : 'Free'}
              </Badge>
            ) : (
              <Badge tone="neutral">Checking…</Badge>
            )}
            {signedIn && detail?.hasSubscription && detail.price && (
              <span className="text-slate-400">
                · billed {detail.price === 'yearly' ? 'yearly' : 'monthly'}
              </span>
            )}
            {signedIn && detail?.status === 'past_due' && (
              <Badge tone="danger">Payment issue</Badge>
            )}
          </div>
          {signedIn && detail?.hasSubscription && detail.currentPeriodEnd && (
            <div className="text-slate-400">
              {detail.cancelAtPeriodEnd
                ? `Cancels on ${formatDate(detail.currentPeriodEnd)}`
                : `Renews on ${formatDate(detail.currentPeriodEnd)}`}
            </div>
          )}
          {signedIn && detail?.status === 'past_due' && (
            <div className="text-amber-300">
              Your last payment failed — use Manage billing to update your payment method.
            </div>
          )}
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
            {detail?.hasSubscription &&
              (detail.cancelAtPeriodEnd ? (
                <Button
                  disabled={busy}
                  onClick={() => cancelOrResume(() => resumeSubscription())}
                >
                  Resume subscription
                </Button>
              ) : confirmingCancel ? (
                <>
                  <Button
                    variant="danger"
                    disabled={busy}
                    onClick={() => cancelOrResume(() => cancelSubscription())}
                  >
                    Confirm cancellation
                  </Button>
                  <Button variant="ghost" disabled={busy} onClick={() => setConfirmingCancel(false)}>
                    Keep subscription
                  </Button>
                </>
              ) : (
                <Button
                  variant="danger"
                  disabled={busy}
                  onClick={() => setConfirmingCancel(true)}
                >
                  Cancel at period end
                </Button>
              ))}
            <Button variant="ghost" disabled={busy} onClick={() => run(() => signOut())}>
              Sign out
            </Button>
          </div>
        ) : view === 'checkEmail' ? (
          <div className="mt-4 flex flex-col gap-3 text-sm text-slate-300">
            <p>
              We sent a confirmation link to <span className="text-slate-100">{formEmail}</span>.
              Open it on this computer to finish creating your account.
            </p>
            <div>
              <AuthLink onClick={() => switchView('signin')}>Back to sign in</AuthLink>
            </div>
          </div>
        ) : view === 'signup' ? (
          <div className="mt-4 flex flex-col gap-4">
            <form className="flex flex-col gap-2" onSubmit={emailSignUp}>
              <Input
                type="text"
                placeholder="Full name (optional)"
                value={formName}
                onChange={(e) => setFormName(e.target.value)}
                autoComplete="name"
              />
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
                placeholder="Password (min 8 characters)"
                value={formPassword}
                onChange={(e) => setFormPassword(e.target.value)}
                autoComplete="new-password"
                minLength={MIN_PASSWORD_LENGTH}
                required
              />
              <Button type="submit" disabled={busy}>
                Create account
              </Button>
            </form>
            <div className="flex gap-4">
              <AuthLink onClick={() => switchView('signin')}>
                Already have an account? Sign in
              </AuthLink>
            </div>
          </div>
        ) : view === 'forgot' ? (
          <div className="mt-4 flex flex-col gap-4">
            {notice ? (
              <p className="text-sm text-slate-300">{notice}</p>
            ) : (
              <form className="flex flex-col gap-2" onSubmit={requestReset}>
                <Input
                  type="email"
                  placeholder="you@example.com"
                  value={formEmail}
                  onChange={(e) => setFormEmail(e.target.value)}
                  autoComplete="email"
                  required
                />
                <Button type="submit" disabled={busy}>
                  Send reset link
                </Button>
              </form>
            )}
            <div className="flex gap-4">
              <AuthLink onClick={() => switchView('signin')}>Back to sign in</AuthLink>
            </div>
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
            <div className="flex gap-4">
              <AuthLink onClick={() => switchView('signup')}>Create account</AuthLink>
              <AuthLink onClick={() => switchView('forgot')}>Forgot password?</AuthLink>
            </div>
          </div>
        )}

        {message && <p className="mt-3 text-sm text-amber-300">{message}</p>}
      </Card>
    </div>
  );
}
