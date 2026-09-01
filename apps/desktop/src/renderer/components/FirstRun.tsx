/**
 * The first-run walkthrough. Shown full-screen over the app until the user finishes or skips it,
 * then never again (the flag lives in the main process — see main/onboarding.ts).
 *
 * Five steps: what Talysman is → pick a blocking mode → install the browser extension and watch
 * for its first heartbeat → pair a USB key → raise the shield. Nothing here is load-bearing for
 * enforcement: every step can be skipped and redone from the normal pages.
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import type { Drive, Policy } from '@talysman/shared';
import { palette, resolveActiveProfile } from '@talysman/shared';
import { productFeaturesForEnvironment } from '@talysman/product';
import { devSimulateExtension, openExternal, request } from '../lib/bridge.js';
import { useFocusStore } from '../store/useFocusStore.js';
import { cx } from '../lib/utils.js';
import { TalysmanMark } from './TalysmanMark.js';

/** A heartbeat older than this means the extension stopped talking to us. */
const CONTACT_STALE_MS = 15_000;

const STEPS = ['welcome', 'profile', 'extension', 'key', 'ready'] as const;
type Step = (typeof STEPS)[number];

/**
 * Onboarding-only preset labels — not part of the enforced `Policy` shape (see
 * `packages/shared/src/policy.ts`). Each preset just sets `defaultAction`/list fields; Smart
 * filtering is a Pro feature configured later from the Blocklists page, not offered here.
 */
type ModePreset = 'blacklist' | 'whitelist' | 'block-all';

const SMART_FILTERING_ENABLED = productFeaturesForEnvironment(
  __APP_CONFIG__.APP_ENV,
).smartFiltering;

/** Map an onboarding preset onto the underlying generalized policy fields. */
function applyPresetToPolicy(base: Policy, preset: ModePreset): Policy {
  switch (preset) {
    case 'blacklist':
      return {
        ...base,
        allowedDomains: SMART_FILTERING_ENABLED ? base.allowedDomains : [],
        defaultAction: 'allow',
        intent: null,
      };
    case 'whitelist':
      return {
        ...base,
        blockedDomains: SMART_FILTERING_ENABLED ? base.blockedDomains : [],
        defaultAction: 'block',
        intent: null,
      };
    case 'block-all':
      return { ...base, blockedDomains: [], allowedDomains: [], defaultAction: 'block', intent: null };
  }
}

const MODES: { value: ModePreset; label: string; blurb: string }[] = [
  {
    value: 'blacklist',
    label: 'Blacklist',
    blurb: 'Block a named set of sites. Everything else stays reachable.',
  },
  {
    value: 'whitelist',
    label: 'Whitelist',
    blurb: 'Nothing is reachable except the handful you allow. The strict one.',
  },
  ...(SMART_FILTERING_ENABLED
    ? [
        {
          value: 'block-all' as const,
          label: 'Block all',
          blurb: 'Total network block. For writing days and deadlines.',
        },
      ]
    : []),
];

/**
 * Published listings, mirroring apps/web's download page. Chromium browsers other than Chrome
 * (Edge, Brave, Vivaldi) install the Chrome Web Store build.
 */
const EXTENSION_STORES: { key: string; name: string; note: string; url: string }[] = [
  {
    key: 'chrome',
    name: 'Chrome',
    note: 'also Edge, Brave, Vivaldi',
    url: 'https://chromewebstore.google.com/detail/talysman/jblidbjafmpbpednomngbbmpkihedeko',
  },
  {
    key: 'firefox',
    name: 'Firefox',
    note: 'Firefox Browser Add-ons',
    url: 'https://addons.mozilla.org/en-US/firefox/addon/talysman/',
  },
];

const DOWNLOAD_PAGE = 'https://talysman.app/download';

const MODE_LABELS: Record<ModePreset, string> = {
  blacklist: 'Blacklist',
  whitelist: 'Whitelist',
  'block-all': 'Block all',
};

export function FirstRun({ onDone }: { onDone: () => void }) {
  const profiles = useFocusStore((s) => s.profiles);
  const activeProfileId = useFocusStore((s) => s.activeProfileId);
  const pairedKeys = useFocusStore((s) => s.pairedKeys);
  const usingMock = useFocusStore((s) => s.usingMock);
  const appEnv = useFocusStore((s) => s.appEnv);
  const extensionContact = useFocusStore((s) => s.extensionContact);
  const refresh = useFocusStore((s) => s.refresh);
  const finishOnboarding = useFocusStore((s) => s.finishOnboarding);

  const profile = resolveActiveProfile(profiles, activeProfileId);
  const [step, setStep] = useState(0);
  // First-run profiles start empty, so there's nothing meaningful to derive the preset from yet.
  const [mode, setMode] = useState<ModePreset>('blacklist');
  const [drives, setDrives] = useState<Drive[]>([]);
  const [driveId, setDriveId] = useState('');
  const [keyLabel, setKeyLabel] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const current: Step = STEPS[step] ?? 'welcome';

  // Wake once when the current contact expires instead of ticking continuously.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    setNow(Date.now());
    if (!extensionContact) return;
    const remaining = Math.max(1, CONTACT_STALE_MS - (Date.now() - extensionContact.at) + 1);
    const timer = window.setTimeout(() => setNow(Date.now()), remaining);
    return () => window.clearTimeout(timer);
  }, [extensionContact]);

  const contactLive = Boolean(extensionContact && now - extensionContact.at < CONTACT_STALE_MS);
  // Once the extension has proved itself we keep the step "satisfied" even if the browser is
  // later closed — the point of the step is that the install worked.
  const contactEverMade = Boolean(extensionContact);

  const scanDrives = useCallback(async () => {
    try {
      const res = await request('listRemovableDrives', undefined);
      setDrives(res.drives);
      setDriveId((c) => (res.drives.some((d) => d.id === c) ? c : (res.drives[0]?.id ?? '')));
    } catch {
      // A drive scan failure isn't worth blocking setup over; the Keys page reports it properly.
    }
  }, []);

  // Scan on entry; the user can explicitly rescan after inserting a drive.
  useEffect(() => {
    if (current !== 'key') return;
    void scanDrives();
  }, [current, scanDrives]);

  const selectedDrive = drives.find((d) => d.id === driveId);
  const hasKey = pairedKeys.length > 0;
  const hasList =
    mode === 'whitelist'
      ? (profile?.policy.allowedDomains.length ?? 0) > 0
      : (profile?.policy.blockedDomains.length ?? 0) > 0;
  // Raising the shield on an empty whitelist would cut the network with no way back but the key,
  // and an empty blacklist blocks nothing at all. Neither is a good way to end setup.
  const canRaise = hasKey && (mode === 'block-all' || hasList);

  async function finish(raiseShield: boolean) {
    setBusy(true);
    setError(null);
    try {
      if (raiseShield) await request('enableFocus', { reason: 'first run' });
      await finishOnboarding();
      onDone();
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  }

  /** Write the chosen preset onto the active profile before moving off the profile step. */
  async function applyMode() {
    if (!profile) return;
    await request('setPolicy', { policy: applyPresetToPolicy(profile.policy, mode) });
    await refresh();
  }

  async function pairSelectedDrive() {
    if (!driveId) return;
    await request('pairKey', { driveId, label: keyLabel.trim() || selectedDrive?.label || 'Key' });
    setKeyLabel('');
    await refresh();
  }

  async function next() {
    setBusy(true);
    setError(null);
    try {
      if (current === 'profile') await applyMode();
      // Pairing here is the whole point of the step, but an unpaired drive shouldn't trap the
      // user — they can pair later from the Keys page.
      if (current === 'key' && driveId && !hasKey) await pairSelectedDrive();
      setStep((s) => Math.min(STEPS.length - 1, s + 1));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const nextLabel = useMemo(() => {
    if (current === 'welcome') return 'Set it up';
    if (current === 'extension') return contactLive || contactEverMade ? 'Continue' : 'Do this later';
    if (current === 'key') return hasKey ? 'Continue' : driveId ? 'Pair this drive' : 'Skip for now';
    return 'Continue';
  }, [current, contactLive, contactEverMade, driveId, hasKey]);

  return (
    <div className="absolute inset-0 z-30 flex flex-col bg-bg">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0"
        style={{
          background: 'radial-gradient(620px 520px at 50% 34%, rgb(var(--color-signal)/0.07), transparent 70%)',
        }}
      />

      {/* Progress rail + escape hatch. */}
      <div className="relative flex items-center gap-2 px-6 py-5">
        {STEPS.map((s, i) => (
          <span
            key={s}
            className={cx(
              'block h-[3px] w-11 rounded-sm transition-colors',
              i <= step ? 'bg-seal' : 'bg-white/10',
            )}
          />
        ))}
        <span className="ml-1.5 font-mono text-[10px] font-medium tracking-[0.16em] text-slate-450">
          {step + 1} / {STEPS.length}
        </span>
        <button
          onClick={() => void finish(false)}
          disabled={busy}
          className="ml-auto text-[11.5px] font-medium text-slate-450 transition hover:text-slate-300 disabled:opacity-50"
        >
          Skip setup
        </button>
      </div>

      <div className="relative flex min-h-0 flex-1 flex-col items-center justify-center px-14 text-center">
        {current === 'welcome' && (
          <div className="flex flex-col items-center animate-rise">
            <TalysmanMark
              size={64}
              className="[filter:drop-shadow(0_0_20px_rgb(var(--color-brand)/0.3))]"
            />
            <h1 className="mt-[22px] text-[34px] font-bold leading-[1.15] tracking-[-0.02em] text-slate-100">
              The shield stays up.
            </h1>
            <p className="mt-3 max-w-[460px] text-[14px] leading-relaxed text-slate-400">
              Talysman isn’t a timer you start. You set your rules once, and a privileged service
              holds the line — even if you quit the app, kill the process, or reboot. A physical USB
              key is the only way back out.
            </p>
          </div>
        )}

        {current === 'profile' && (
          <div className="flex flex-col items-center animate-rise">
            <StepKicker>Step 2 · Your first profile</StepKicker>
            <StepTitle>How much do you want blocked?</StepTitle>
            <StepBlurb>
              This becomes a profile you can rename, duplicate and schedule. Most people end up with
              two or three.
            </StepBlurb>
            <div className="mt-[26px] flex gap-3">
              {MODES.map((m) => {
                const on = mode === m.value;
                return (
                  <button
                    key={m.value}
                    onClick={() => setMode(m.value)}
                    className={cx(
                      // `flex flex-col` defeats the default vertical centring of button content,
                      // so cards with different blurb lengths still line their titles up.
                      'flex w-[212px] flex-col rounded-xl border p-4 text-left transition',
                      on
                        ? 'border-seal/30 bg-seal/[0.09] shadow-[inset_0_1px_0_rgb(var(--color-white)/0.06),0_0_18px_rgb(var(--color-signal)/0.10)]'
                        : 'border-white/[0.07] bg-white/[0.025] hover:border-white/[0.14]',
                    )}
                  >
                    <div className="flex items-center gap-2.5">
                      <span
                        className={cx(
                          'block h-[9px] w-[9px] rounded-full border',
                          on
                            ? 'border-seal bg-seal shadow-[0_0_7px_1px_rgb(var(--color-signal)/0.6)]'
                            : 'border-white/25 bg-transparent',
                        )}
                      />
                      <span
                        className={cx(
                          'text-[14px] font-semibold',
                          on ? 'text-slate-100' : 'text-slate-250',
                        )}
                      >
                        {m.label}
                      </span>
                    </div>
                    <div className="mt-[7px] text-[12px] leading-relaxed text-slate-400">
                      {m.blurb}
                    </div>
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {current === 'extension' && (
          <ExtensionStep
            live={contactLive}
            everMade={contactEverMade}
            contact={extensionContact}
            showMockHelper={usingMock && appEnv !== 'production'}
          />
        )}

        {current === 'key' && (
          <div className="flex flex-col items-center animate-rise">
            <StepKicker>Step 4 · Your key</StepKicker>
            <StepTitle>Pair a USB drive</StepTitle>
            <StepBlurb>
              Any USB stick works. Talysman remembers its identity — plug it in to lower the shield,
              leave it in a drawer to keep yourself honest.
            </StepBlurb>

            <div className="mt-6 flex w-[420px] flex-col gap-2">
              {hasKey ? (
                <div className="rounded-[11px] border border-seal/30 bg-seal/[0.09] px-4 py-3.5 text-left">
                  <div className="text-[13px] font-semibold text-sealInk">
                    {pairedKeys.length === 1
                      ? `“${pairedKeys[0]?.label}” is paired`
                      : `${pairedKeys.length} keys paired`}
                  </div>
                  <div className="mt-0.5 font-mono text-[11px] text-slate-450">
                    pair spares later from the Keys page
                  </div>
                </div>
              ) : (
                <>
                  {drives.map((d) => {
                    const on = d.id === driveId;
                    return (
                      <button
                        key={d.id}
                        onClick={() => setDriveId(d.id)}
                        className={cx(
                          'flex items-center gap-3 rounded-[11px] border px-[15px] py-3 text-left transition',
                          on
                            ? 'border-seal/30 bg-seal/[0.09]'
                            : 'border-white/[0.07] bg-white/[0.025] hover:border-white/[0.14]',
                        )}
                      >
                        <span
                          className={cx(
                            'block h-[9px] w-[9px] shrink-0 rounded-full border',
                            on
                              ? 'border-seal bg-seal shadow-[0_0_7px_1px_rgb(var(--color-signal)/0.6)]'
                              : 'border-white/25 bg-transparent',
                          )}
                        />
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-[13px] font-semibold text-slate-150">
                            {d.label}
                          </span>
                          {d.serialAmbiguous && (
                            <span className="mt-0.5 block font-mono text-[11px] text-slate-450">
                              no stable serial · uses a file marker
                            </span>
                          )}
                        </span>
                      </button>
                    );
                  })}

                  {drives.length === 0 && (
                    <div className="rounded-[11px] border border-dashed border-white/[0.10] px-4 py-5 text-[12.5px] text-slate-500">
                      No removable drives found. Plug one in, then rescan.
                      <button
                        onClick={() => void scanDrives()}
                        className="ml-2 font-semibold text-slate-300 hover:text-white"
                      >
                        Rescan
                      </button>
                    </div>
                  )}

                  {drives.length > 0 && (
                    <input
                      value={keyLabel}
                      onChange={(e) => setKeyLabel(e.target.value)}
                      placeholder="Label · e.g. Desk key"
                      className="rounded-[9px] border border-white/[0.09] bg-white/[0.035] px-3 py-2 text-[12.5px] text-white outline-none transition placeholder:text-slate-600 focus:border-white/25"
                    />
                  )}
                </>
              )}

              <div className="flex items-center gap-2 px-0.5 py-1">
                <span className="block h-1.5 w-1.5 rounded-full bg-seal" />
                <span className="text-[11.5px] text-slate-500">Drive scans run only when requested.</span>
              </div>
            </div>
          </div>
        )}

        {current === 'ready' && (
          <div className="flex flex-col items-center animate-rise">
            <div className="relative flex h-[186px] w-[186px] items-center justify-center">
              <div className="absolute inset-0 rounded-full border border-seal/30 shadow-[0_0_34px_rgb(var(--color-signal)/0.16),inset_0_0_34px_rgb(var(--color-signal)/0.06)]" />
              <div className="absolute inset-[18px] rounded-full border border-dashed border-white/[0.07]" />
              <div
                aria-hidden
                className="absolute inset-[34px] rounded-full"
                style={{
                  background: 'radial-gradient(circle, rgb(var(--color-signal)/0.14), transparent 72%)',
                }}
              />
              <div className="relative text-[15px] font-bold tracking-[0.14em] text-sealInk">
                READY
              </div>
            </div>
            <h1 className="mt-[18px] text-[28px] font-bold leading-[1.15] tracking-[-0.02em] text-slate-100">
              {profile?.name ?? 'Default'} · {MODE_LABELS[mode]} ·{' '}
              {hasKey ? (pairedKeys[0]?.label ?? 'Key paired') : 'No key'}
            </h1>
            <p className="mt-2.5 max-w-[440px] text-[13.5px] leading-relaxed text-slate-400">
              {canRaise
                ? 'Raising the shield starts enforcement immediately and keeps it on across restarts. You can add more profiles and schedule them later.'
                : !hasKey
                  ? 'Pair a USB key from the Keys page before you can raise the shield — it’s the only way back out of a session.'
                  : 'Add the sites this profile covers from the Blocklists page, then raise the shield from the dashboard.'}
            </p>
          </div>
        )}

        {error && <p className="mt-5 text-[12.5px] text-dangerInk">{error}</p>}
      </div>

      <div className="relative flex items-center justify-between px-6 pb-6">
        <button
          onClick={() => setStep((s) => Math.max(0, s - 1))}
          disabled={step === 0 || busy}
          className="rounded-full border border-white/[0.10] bg-white/[0.04] px-[22px] py-2.5 text-[13px] font-medium text-slate-200 transition hover:bg-white/[0.08] disabled:text-slate-600 disabled:hover:bg-white/[0.04]"
        >
          Back
        </button>

        {current === 'ready' ? (
          <button
            onClick={() => void finish(canRaise)}
            disabled={busy}
            className={cx(
              'rounded-full px-7 py-2.5 text-[13px] font-semibold transition disabled:opacity-50',
              canRaise
                ? 'border border-seal/[0.38] bg-seal/[0.16] text-sealInk shadow-[0_0_22px_rgb(var(--color-signal)/0.18)] hover:bg-seal/[0.22]'
                : 'border border-signal bg-signal text-signalInk shadow-[0_8px_28px_rgb(var(--color-signal)/0.13)] hover:bg-signalHi',
            )}
          >
            {canRaise ? 'Raise shield' : 'Finish setup'}
          </button>
        ) : (
          <button
            onClick={() => void next()}
            disabled={busy}
            className="rounded-full border border-signal bg-signal px-7 py-2.5 text-[13px] font-semibold text-signalInk shadow-[0_8px_28px_rgb(var(--color-signal)/0.13)] transition hover:bg-signalHi disabled:opacity-50"
          >
            {busy ? 'Working…' : nextLabel}
          </button>
        )}
      </div>
    </div>
  );
}

/** Extensions report their browser lowercase ("firefox"); title-case it for display. */
function browserName(browser: string | undefined): string {
  if (!browser) return 'Browser';
  return browser.charAt(0).toUpperCase() + browser.slice(1);
}

/** The extension step: install links plus a live read on whether the handshake actually works. */
function ExtensionStep({
  live,
  everMade,
  contact,
  showMockHelper,
}: {
  live: boolean;
  everMade: boolean;
  contact: { browser: string; extensionVersion?: string; healthy: boolean } | undefined;
  showMockHelper: boolean;
}) {
  // Three states: still listening, talking but not able to block, and fully working.
  const state = !everMade ? 'waiting' : contact?.healthy ? 'ok' : 'degraded';

  return (
    <div className="flex flex-col items-center animate-rise">
      <StepKicker>Step 3 · Your browser</StepKicker>
      <StepTitle>Add the browser extension</StepTitle>
      <StepBlurb>
        The service blocks at the network layer, but a browser hides plenty of traffic from it. The
        extension blocks the rest inside the browser — and proves it’s alive every few seconds.
      </StepBlurb>

      <div className="mt-6 flex gap-2.5">
        {EXTENSION_STORES.map((s) => (
          <button
            key={s.key}
            onClick={() => void openExternal(s.url)}
            className="w-[190px] rounded-[11px] border border-white/[0.07] bg-white/[0.025] px-4 py-3 text-left transition hover:border-white/[0.16] hover:bg-white/[0.05]"
          >
            <span className="block text-[13px] font-semibold text-slate-150">Install for {s.name}</span>
            <span className="mt-0.5 block font-mono text-[10.5px] text-slate-450">{s.note}</span>
          </button>
        ))}
      </div>

      <button
        onClick={() => void openExternal(DOWNLOAD_PAGE)}
        className="mt-2.5 text-[11.5px] font-medium text-slate-450 transition hover:text-slate-300"
      >
        Other browsers →
      </button>

      {/* The handshake read-out: the app on the left, the browser on the right, and the channel
          between them lighting up once a heartbeat lands. */}
      <div
        className={cx(
          'mt-7 flex w-[470px] items-center gap-4 rounded-xl border px-5 py-4 transition-colors',
          state === 'ok'
            ? 'border-ok/30 bg-ok/[0.08]'
            : state === 'degraded'
              ? 'border-warn/30 bg-warn/[0.08]'
              : 'border-white/[0.08] bg-white/[0.02]',
        )}
      >
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-white/[0.10] bg-white/[0.04]">
          <TalysmanMark size={18} />
        </span>

        <HandshakeChannel state={state} live={live} />

        <span
          className={cx(
            'flex h-9 w-9 shrink-0 items-center justify-center rounded-full border text-[13px]',
            state === 'ok'
              ? 'border-ok/40 bg-ok/[0.12] text-okInk'
              : state === 'degraded'
                ? 'border-warn/40 bg-warn/[0.12] text-warn'
                : 'border-white/[0.10] bg-white/[0.04] text-slate-450',
          )}
        >
          {/* A browser window, drawn rather than iconed so it matches the hairline language. */}
          <svg width="17" height="17" viewBox="0 0 24 24" fill="none" aria-hidden>
            <rect x="3" y="4.5" width="18" height="15" rx="2.5" stroke="currentColor" strokeWidth="1.4" />
            <path d="M3 9h18" stroke="currentColor" strokeWidth="1.4" />
            <circle cx="6.4" cy="6.8" r="0.85" fill="currentColor" />
          </svg>
        </span>
      </div>

      <div className="mt-3 flex h-4 items-center gap-2">
        {state === 'waiting' && (
          <>
            <span className="block h-1.5 w-1.5 rounded-full bg-seal" />
            <span className="text-[12px] text-slate-400">
              Listening for the extension… install it and this turns green on its own.
            </span>
          </>
        )}
        {state === 'ok' && (
          <span className="text-[12px] text-okInk">
            {browserName(contact?.browser)} extension connected
            {contact?.extensionVersion ? ` · v${contact.extensionVersion}` : ''}
            {live ? '' : ' · browser now closed'}
          </span>
        )}
        {state === 'degraded' && (
          <span className="text-[12px] text-warn">
            {browserName(contact?.browser)} extension is talking to Talysman but can’t block yet —
            open it and allow its site permissions.
          </span>
        )}
      </div>

      {showMockHelper && (
        <button
          onClick={() => void devSimulateExtension()}
          className="mt-4 rounded-[9px] border border-white/[0.10] bg-white/[0.04] px-3 py-1.5 text-[11px] font-medium text-slate-400 transition hover:bg-white/[0.08]"
        >
          Dev · simulate a heartbeat
        </button>
      )}
    </div>
  );
}

/** The animated link between the app and the browser. Dashed while searching, solid on contact. */
function HandshakeChannel({ state, live }: { state: 'waiting' | 'ok' | 'degraded'; live: boolean }) {
  const connected = state !== 'waiting';
  const color =
    state === 'ok'
      ? palette.colors.success
      : state === 'degraded'
        ? palette.colors.warning
        : undefined;

  return (
    <span className="relative flex h-9 flex-1 items-center">
      <span
        className={cx(
          'block h-px w-full',
          connected ? '' : 'bg-[repeating-linear-gradient(90deg,rgb(var(--color-white)/0.18)_0_5px,transparent_5px_11px)]',
        )}
        style={connected ? { backgroundColor: color, boxShadow: `0 0 10px 1px ${color}66` } : undefined}
      />
      {/* Static contact marker; avoids keeping Chromium's compositor active while idle. */}
      {!connected && <span className="absolute left-1/4 block h-1.5 w-1.5 rounded-full bg-seal/70" />}
      {connected && live && (
        <span
          className="absolute block h-2 w-2 rounded-full"
          style={{
            backgroundColor: color,
            boxShadow: `0 0 10px 2px ${color}`,
          }}
        />
      )}
      <span
        className={cx(
          'absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full border px-2 py-0.5 font-mono text-[8.5px] tracking-[0.14em]',
          connected
            ? state === 'ok'
              ? 'border-ok/40 bg-bg text-okInk'
              : 'border-warn/40 bg-bg text-warn'
            : 'border-white/[0.10] bg-bg text-slate-500',
        )}
      >
        {connected ? (state === 'ok' ? 'HANDSHAKE OK' : 'NO BLOCKING') : 'NO CONTACT'}
      </span>
    </span>
  );
}

function StepKicker({ children }: { children: React.ReactNode }) {
  return (
    <div className="font-mono text-[10px] font-medium uppercase tracking-[0.2em] text-seal">
      {children}
    </div>
  );
}

function StepTitle({ children }: { children: React.ReactNode }) {
  return (
    <h1 className="mt-3.5 text-[30px] font-bold leading-[1.15] tracking-[-0.02em] text-slate-100">
      {children}
    </h1>
  );
}

function StepBlurb({ children }: { children: React.ReactNode }) {
  return (
    <p className="mt-2.5 max-w-[470px] text-[13.5px] leading-[1.55] text-slate-400">{children}</p>
  );
}
