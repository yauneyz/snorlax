import React, { useMemo, useState } from 'react';
import type { AppRef, Mode, Policy, Profile } from '@talysman/shared';
import {
  EMPTY_POLICY,
  MAX_PROFILE_NAME_LENGTH,
  nextProfileColor,
  resolveActiveProfile,
} from '@talysman/shared';
import { siblingsFor } from '@talysman/core/browser';
import { listInstalledApps, request } from '../lib/bridge.js';
import { useFocusStore } from '../store/useFocusStore.js';
import { Badge, Button, Input, Kicker, ProfileDot } from '../components/ui/index.js';
import { cx, profileSummary } from '../lib/utils.js';
import type { AppPickerItem } from '../../shared/appPicker.js';
import {
  allowedPolicyModes,
  maxPolicyApps,
  maxPolicyDomains,
  maxProfiles,
} from '../../shared/productLimits.js';

const MODES: { value: Mode; label: string; hint: string }[] = [
  { value: 'blacklist', label: 'Blacklist', hint: 'Block only the sites you list.' },
  { value: 'whitelist', label: 'Whitelist', hint: 'Block everything except your list.' },
  { value: 'block-all', label: 'Block all', hint: 'No internet at all.' },
];

function appKey(app: AppRef): string {
  return [
    app.windowsImageName?.toLowerCase() ?? '',
    app.linuxProcessName?.toLowerCase() ?? '',
    app.macBundleId ?? '',
  ].join('|');
}

/**
 * The executable identifiers behind an app entry, shown as the chip's small print. Manual
 * entries name the executable as their label, so drop anything that just repeats it.
 */
function appIdentifiers(app: AppRef): string {
  return [...new Set([app.windowsImageName, app.linuxProcessName, app.macBundleId])]
    .filter((id): id is string => Boolean(id) && id !== app.label)
    .join(' · ');
}

export function Blocklists({ onUpgrade }: { onUpgrade: () => void }) {
  const profiles = useFocusStore((s) => s.profiles);
  const activeProfileId = useFocusStore((s) => s.activeProfileId);
  const keyPresent = useFocusStore((s) => s.keyPresent);
  const productLimits = useFocusStore((s) => s.productLimits);
  const refresh = useFocusStore((s) => s.refresh);
  // Which profile the editor is pointed at. `null` keeps it tracking whatever focus is
  // enforcing, so a scheduled profile switch carries the editor with it.
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [domain, setDomain] = useState('');
  const [appName, setAppName] = useState('');
  const [pickerOpen, setPickerOpen] = useState(false);
  const [pickerLoading, setPickerLoading] = useState(false);
  const [pickerError, setPickerError] = useState<string | null>(null);
  const [pickerItems, setPickerItems] = useState<AppPickerItem[]>([]);
  const [pickerQuery, setPickerQuery] = useState('');
  const [selectedApps, setSelectedApps] = useState<Set<string>>(() => new Set());
  const [error, setError] = useState<string | null>(null);

  const selected = resolveActiveProfile(profiles, selectedId ?? activeProfileId);
  const policy = selected?.policy ?? EMPTY_POLICY;
  const isActive = selected?.id === activeProfileId;
  const accent = selected?.color ?? '#4fd6c0';
  const profileLimit = maxProfiles(productLimits);
  const profileLimitReached = profileLimit !== null && profiles.length >= profileLimit;

  const allowedModes = allowedPolicyModes(productLimits);
  const maxDomains = maxPolicyDomains(productLimits, policy.mode);
  const maxApps = maxPolicyApps(productLimits);
  const domainLimitReached = maxDomains !== null && policy.domains.length >= maxDomains;
  const appBlockingLocked = maxApps === 0;
  const existingAppKeys = useMemo(
    () => new Set(policy.apps.map((app) => appKey(app))),
    [policy.apps],
  );
  const appLimitReached = maxApps !== null && policy.apps.length >= maxApps;
  const remainingAppSlots = maxApps === null ? Infinity : Math.max(0, maxApps - policy.apps.length);
  const filteredPickerItems = useMemo(() => {
    const q = pickerQuery.trim().toLowerCase();
    if (!q) return pickerItems;
    return pickerItems.filter((item) => {
      const haystack = [
        item.label,
        item.app.windowsImageName,
        item.app.linuxProcessName,
        item.app.macBundleId,
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();
      return haystack.includes(q);
    });
  }, [pickerItems, pickerQuery]);

  /** Every edit on this page writes one whole profile; the service derives the rest. */
  async function saveProfile(next: Profile): Promise<boolean> {
    setError(null);
    try {
      await request('setProfile', { profile: next });
      await refresh();
      return true;
    } catch (e) {
      setError((e as Error).message);
      return false;
    }
  }

  async function save(next: Policy) {
    if (!selected) return;
    await saveProfile({ ...selected, policy: next });
  }

  async function addProfile() {
    if (profileLimitReached) return onUpgrade();
    const profile: Profile = {
      id: `profile-${Date.now().toString(36)}`,
      name: `Profile ${profiles.length + 1}`,
      color: nextProfileColor(profiles),
      policy: EMPTY_POLICY,
    };
    if (await saveProfile(profile)) setSelectedId(profile.id);
  }

  /** Copy the selected profile's whole policy under a new id — the fastest way to a variant. */
  async function duplicateProfile() {
    if (!selected) return;
    if (profileLimitReached) return onUpgrade();
    const profile: Profile = {
      ...selected,
      id: `profile-${Date.now().toString(36)}`,
      name: `${selected.name} copy`.slice(0, MAX_PROFILE_NAME_LENGTH),
      color: nextProfileColor(profiles),
    };
    if (await saveProfile(profile)) setSelectedId(profile.id);
  }

  async function renameProfile(name: string) {
    const trimmed = name.trim();
    if (!selected || !trimmed || trimmed === selected.name) return;
    await saveProfile({ ...selected, name: trimmed });
  }

  async function runProfileRequest(run: () => Promise<unknown>) {
    setError(null);
    try {
      await run();
      await refresh();
    } catch (e) {
      setError((e as Error).message);
    }
  }

  const deleteProfile = (profileId: string) =>
    runProfileRequest(async () => {
      await request('deleteProfile', { profileId });
      if (selectedId === profileId) setSelectedId(null);
    });

  const activateProfile = (profileId: string) =>
    runProfileRequest(() => request('setActiveProfile', { profileId }));

  const setMode = (mode: Mode) => save({ ...policy, mode });
  const addDomain = () => {
    if (!domain.trim()) return;
    if (domainLimitReached) {
      return setError(`Free supports up to ${maxDomains} blocked websites in blacklist mode.`);
    }
    void save({ ...policy, domains: [...policy.domains, domain.trim()] });
    setDomain('');
  };
  const removeDomain = (d: string) => save({ ...policy, domains: policy.domains.filter((x) => x !== d) });
  const addApp = () => {
    if (!appName.trim()) return;
    if (maxApps !== null && policy.apps.length >= maxApps) {
      return setError('Free does not include app blocking.');
    }
    const name = appName.trim();
    void save({
      ...policy,
      apps: [...policy.apps, { windowsImageName: name, linuxProcessName: name, label: name }],
    });
    setAppName('');
  };
  const removeApp = (target: AppRef) =>
    save({ ...policy, apps: policy.apps.filter((a) => appKey(a) !== appKey(target)) });

  async function openAppPicker() {
    setPickerOpen(true);
    setPickerQuery('');
    setSelectedApps(new Set());
    setPickerError(null);
    setPickerLoading(true);
    try {
      setPickerItems(await listInstalledApps());
    } catch (e) {
      setPickerError((e as Error).message);
      setPickerItems([]);
    } finally {
      setPickerLoading(false);
    }
  }

  function togglePickerItem(item: AppPickerItem) {
    const key = appKey(item.app);
    if (existingAppKeys.has(key)) return;
    setSelectedApps((prev) => {
      const next = new Set(prev);
      if (next.has(key)) {
        next.delete(key);
        return next;
      }
      if (next.size >= remainingAppSlots) return next;
      next.add(key);
      return next;
    });
  }

  async function addSelectedApps() {
    const picked = pickerItems
      .filter((item) => selectedApps.has(appKey(item.app)))
      .map((item) => item.app);
    if (picked.length === 0) return;
    await save({ ...policy, apps: [...policy.apps, ...picked] });
    setPickerOpen(false);
    setSelectedApps(new Set());
  }

  const listKicker =
    policy.mode === 'blacklist' ? 'Blocked sites' : policy.mode === 'whitelist' ? 'Allowed sites' : 'Sites';

  return (
    <div className="flex h-full min-h-0 flex-col pt-3">
      <div className="flex items-center gap-3">
        {/* The profile is the page's subject, so it doubles as the heading and the switcher. */}
        <div className="relative">
          <button
            onClick={() => setMenuOpen((v) => !v)}
            aria-expanded={menuOpen}
            className={cx(
              'flex items-center gap-3 rounded-[11px] border py-2 pl-3 pr-3.5 transition',
              menuOpen
                ? 'border-white/[0.18] bg-white/[0.07]'
                : 'border-white/[0.09] bg-white/[0.03] hover:border-white/[0.14] hover:bg-white/[0.05]',
            )}
          >
            <ProfileDot color={accent} size={10} glow className="rounded-[3px]" />
            <span className="flex min-w-0 flex-col items-start gap-0.5">
              <span className="max-w-[190px] truncate text-[17px] font-bold leading-none text-slate-100">
                {selected?.name ?? 'No profile'}
              </span>
              <span className="font-mono text-[10.5px] uppercase tracking-[0.08em] text-slate-500">
                {selected ? profileSummary(selected) : '—'}
              </span>
            </span>
            <span className="flex flex-col items-start gap-[3px] border-l border-white/[0.10] pl-[7px] pt-px">
              <span className="font-mono text-[9px] font-medium tracking-[0.14em] text-slate-450">
                PROFILE
              </span>
              <span className="text-[11px] text-slate-400">
                {profiles.length} to switch between
              </span>
            </span>
            <span
              className={cx(
                'ml-0.5 text-[11px] text-slate-400 transition-transform',
                menuOpen && 'rotate-180',
              )}
            >
              ▾
            </span>
          </button>

          {menuOpen && (
            <>
              <div className="fixed inset-0 z-40" onClick={() => setMenuOpen(false)} />
              <div className="absolute left-0 top-[calc(100%+7px)] z-50 w-[322px] animate-rise rounded-xl border border-white/[0.12] bg-[rgba(13,14,18,0.97)] p-[7px] shadow-[0_18px_46px_rgba(0,0,0,0.6)] backdrop-blur-xl">
                <div className="px-2 pb-[7px] pt-1.5 font-mono text-[9.5px] font-medium tracking-[0.18em] text-slate-450">
                  SWITCH PROFILE ·{' '}
                  {profileLimit === null ? profiles.length : `${profiles.length}/${profileLimit}`}
                </div>

                <div className="flex max-h-56 flex-col gap-0.5 overflow-y-auto">
                  {profiles.map((p) => (
                    <button
                      key={p.id}
                      onClick={() => {
                        setSelectedId(p.id);
                        setMenuOpen(false);
                      }}
                      className={cx(
                        'flex items-center gap-2.5 rounded-[9px] border px-2.5 py-2.5 text-left transition',
                        p.id === selected?.id
                          ? 'border-white/[0.12] bg-white/[0.06]'
                          : 'border-white/[0.05] bg-transparent hover:border-white/[0.10] hover:bg-white/[0.03]',
                      )}
                    >
                      <ProfileDot color={p.color} />
                      <span className="min-w-0 flex-1">
                        <span
                          className={cx(
                            'block truncate text-[12.5px] font-semibold',
                            p.id === selected?.id ? 'text-slate-100' : 'text-slate-250',
                          )}
                        >
                          {p.name}
                        </span>
                        <span className="mt-0.5 block truncate font-mono text-[10.5px] text-slate-450">
                          {profileSummary(p)}
                        </span>
                      </span>
                      {p.id === activeProfileId ? (
                        <Badge tone="ok">ON</Badge>
                      ) : (
                        p.id === selected?.id && (
                          <span className="text-[11px] text-slate-400">editing</span>
                        )
                      )}
                    </button>
                  ))}
                </div>

                <div className="mt-1.5 flex flex-col gap-0.5 border-t border-white/[0.07] pt-1.5">
                  <button
                    onClick={() => {
                      setMenuOpen(false);
                      void addProfile();
                    }}
                    className="flex items-center gap-2.5 rounded-[9px] px-2.5 py-2 text-left text-[12px] font-medium text-slate-200 transition hover:bg-white/[0.05]"
                  >
                    <span className="font-mono text-[13px] text-slate-500">+</span>
                    {profileLimitReached ? 'Upgrade for more profiles' : 'New profile'}
                  </button>
                  <button
                    onClick={() => {
                      setMenuOpen(false);
                      void duplicateProfile();
                    }}
                    disabled={!selected}
                    className="flex items-center gap-2.5 rounded-[9px] px-2.5 py-2 text-left text-[12px] font-medium text-slate-400 transition hover:bg-white/[0.05] hover:text-slate-200 disabled:opacity-45"
                  >
                    <span className="font-mono text-[13px] text-slate-500">⧉</span>
                    Duplicate {selected?.name}
                  </button>
                </div>

                <div className="mt-1.5 border-t border-white/[0.07] px-1.5 pb-1 pt-2">
                  <div className="flex items-baseline justify-between">
                    <Kicker className="text-[9.5px] tracking-[0.18em]">Rename</Kicker>
                    {profiles.length > 1 && (
                      <button
                        onClick={() => {
                          setMenuOpen(false);
                          if (selected) void deleteProfile(selected.id);
                        }}
                        className="text-[11px] font-medium text-slate-500 transition hover:text-dangerInk"
                      >
                        delete profile
                      </button>
                    )}
                  </div>
                  <Input
                    key={selected?.id}
                    className="mt-1.5"
                    defaultValue={selected?.name ?? ''}
                    maxLength={MAX_PROFILE_NAME_LENGTH}
                    onBlur={(e) => void renameProfile(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
                    placeholder="Profile name"
                    aria-label="Profile name"
                  />
                  {/* Only worth saying while the key is out — with it in, nothing here is gated. */}
                  {!keyPresent && (
                    <p className="mt-2 text-[11px] leading-relaxed text-slate-450">
                      Loosening a profile needs your key.
                    </p>
                  )}
                </div>
              </div>
            </>
          )}
        </div>

        {isActive ? (
          <Badge tone="ok">ENFORCING NOW</Badge>
        ) : (
          <Button
            variant="ghost"
            onClick={() => selected && void activateProfile(selected.id)}
            className="ml-auto"
          >
            Activate now
          </Button>
        )}
      </div>

      <section className="flex min-h-0 min-w-0 flex-1 flex-col">
        <div className="mt-3 flex gap-2">
          {MODES.map((m) => {
            const on = policy.mode === m.value;
            const locked = Boolean(allowedModes && !allowedModes.includes(m.value));
            return (
              <button
                key={m.value}
                onClick={() => (locked ? onUpgrade() : setMode(m.value))}
                aria-disabled={locked}
                className={cx(
                  'flex-1 rounded-[10px] border px-3 py-2.5 text-left transition',
                  on
                    ? 'border-seal/30 bg-seal/[0.09] shadow-[inset_0_1px_0_rgba(255,255,255,0.06),0_0_18px_rgba(79,214,192,0.10)]'
                    : 'border-white/[0.07] bg-white/[0.025] hover:border-white/[0.14] hover:bg-white/[0.05]',
                  locked && 'opacity-65',
                )}
              >
                <span className="flex items-center gap-2">
                  <span
                    className={cx(
                      'block h-2 w-2 rounded-full border',
                      on
                        ? 'border-seal bg-seal shadow-[0_0_7px_1px_rgba(79,214,192,0.6)]'
                        : 'border-white/25 bg-transparent',
                    )}
                  />
                  <span
                    className={cx(
                      'text-[12.5px] font-semibold',
                      on ? 'text-slate-100' : 'text-slate-250',
                    )}
                  >
                    {m.label}
                  </span>
                  {locked && <Badge tone="neutral">Pro</Badge>}
                </span>
                <span className="mt-1 block pl-4 text-[11px] leading-snug text-slate-400">
                  {m.hint}
                </span>
              </button>
            );
          })}
        </div>

        {policy.mode === 'block-all' ? (
          <div className="mt-4 flex min-h-0 flex-1 flex-col items-center justify-center gap-1.5 rounded-[10px] border border-dashed border-[#ff8f6b]/30 bg-[#ff8f6b]/[0.05] p-6 text-center">
            <span className="text-[14px] font-semibold text-[#ffb59d]">No list needed</span>
            <span className="max-w-xs text-[12px] leading-relaxed text-slate-400">
              Block-all cuts every outbound connection. Only loopback stays reachable.
            </span>
          </div>
        ) : (
          <>
            <div className="mt-4 flex items-baseline gap-2.5">
              <Kicker>{listKicker}</Kicker>
              <span className="text-[11px] text-slate-600">
                {maxDomains === null
                  ? policy.domains.length
                  : `${policy.domains.length}/${maxDomains}`}
              </span>
              <span className="ml-auto text-[11px] text-slate-450">
                wildcards allowed as a leading “*.”
              </span>
            </div>

            <div className="mt-2 flex gap-2">
              <Input
                value={domain}
                onChange={(e) => setDomain(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && addDomain()}
                placeholder={policy.mode === 'whitelist' ? 'mail.google.com' : 'reddit.com'}
                disabled={domainLimitReached}
                className="font-mono"
              />
              <Button onClick={addDomain} disabled={domainLimitReached} className="shrink-0 px-5">
                Add
              </Button>
            </div>

            {/* Two columns of hairline-separated rows: the 1px grid gap *is* the divider. */}
            <div className="mt-2.5 grid min-h-0 flex-1 grid-cols-2 content-start gap-px overflow-y-auto rounded-[10px] border border-white/[0.06] bg-white/[0.05]">
              {policy.domains.map((d) => {
                const siblings = siblingsFor(d);
                return (
                  <div key={d} className="flex items-center gap-2.5 bg-panel px-3.5 py-2">
                    <span
                      className="block h-[5px] w-[5px] shrink-0 rounded-full"
                      style={{ backgroundColor: accent }}
                    />
                    <span className="min-w-0 flex-1 truncate font-mono text-[12.5px] text-slate-200">
                      {d}
                    </span>
                    {siblings.length > 0 && (
                      <span
                        className="hidden max-w-[40%] truncate text-[11px] text-slate-450 xl:block"
                        title={siblings.join(', ')}
                      >
                        also {siblings.join(', ')}
                      </span>
                    )}
                    <button
                      onClick={() => removeDomain(d)}
                      className="shrink-0 text-[11px] font-medium text-slate-500 transition hover:text-dangerInk"
                    >
                      remove
                    </button>
                  </div>
                );
              })}
              {policy.domains.length === 0 && (
                <p className="col-span-2 bg-panel px-3.5 py-3 text-[12px] text-slate-500">
                  No sites yet.
                </p>
              )}
            </div>
          </>
        )}

        <div className="mt-4 flex items-baseline gap-2.5">
          <Kicker>Apps blocked</Kicker>
          <span className="text-[11px] text-slate-600">
            {maxApps === null ? policy.apps.length : `${policy.apps.length}/${maxApps}`}
          </span>
          {appBlockingLocked ? (
            <button
              onClick={onUpgrade}
              className="ml-auto text-[11px] font-medium text-slate-400 transition hover:text-slate-200"
            >
              Upgrade for app blocking →
            </button>
          ) : (
            <button
              onClick={openAppPicker}
              disabled={appLimitReached}
              className="ml-auto text-[11px] font-medium text-slate-400 transition hover:text-slate-200 disabled:opacity-45"
            >
              Choose apps →
            </button>
          )}
        </div>

        {!appBlockingLocked && (
          <div className="mt-2 flex gap-2">
            <Input
              value={appName}
              onChange={(e) => setAppName(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && addApp()}
              placeholder="Manual entry, e.g. chrome.exe or chrome"
              disabled={appLimitReached}
              className="font-mono"
            />
            <Button onClick={addApp} disabled={appLimitReached} className="shrink-0 px-5">
              Add
            </Button>
          </div>
        )}

        <div className="mt-2.5 flex flex-wrap gap-1.5">
          {policy.apps.map((a) => (
            <span
              key={appKey(a)}
              className="inline-flex items-center gap-2 rounded-lg border border-white/[0.08] bg-white/[0.03] py-1.5 pl-2.5 pr-1.5 text-[11.5px] font-medium text-slate-200"
            >
              {a.label}
              <span className="font-mono text-[10px] text-slate-450">{appIdentifiers(a)}</span>
              <button
                onClick={() => removeApp(a)}
                aria-label={`Remove ${a.label}`}
                className="rounded px-1 text-slate-500 transition hover:text-dangerInk"
              >
                ×
              </button>
            </span>
          ))}
          {policy.apps.length === 0 && (
            <p className="text-[12px] text-slate-500">
              {appBlockingLocked ? 'App blocking is a Pro feature.' : 'No apps yet.'}
            </p>
          )}
        </div>

        {error && <p className="mt-3 text-[12.5px] text-dangerInk">{error}</p>}
      </section>

      {pickerOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-[rgba(4,5,7,0.72)] px-4 backdrop-blur-md"
          role="dialog"
          aria-modal="true"
          aria-labelledby="app-picker-title"
        >
          <div className="flex max-h-[82vh] w-full max-w-2xl flex-col rounded-xl border border-white/[0.09] bg-[rgba(10,11,14,0.96)] shadow-[0_24px_60px_-20px_rgba(0,0,0,0.9)]">
            <div className="border-b border-white/[0.07] p-5">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <h2
                    id="app-picker-title"
                    className="font-mono text-[10px] font-medium uppercase tracking-[0.2em] text-slate-500"
                  >
                    Choose apps
                  </h2>
                  <p className="mt-2 text-[12.5px] text-slate-400">
                    {selectedApps.size} selected
                    {maxApps !== null ? ` · ${remainingAppSlots} slots available` : ''}
                  </p>
                </div>
                <button
                  onClick={() => setPickerOpen(false)}
                  className="rounded-lg px-2 py-1 text-[12px] text-slate-400 hover:bg-white/[0.06] hover:text-white"
                  aria-label="Close app picker"
                >
                  Close
                </button>
              </div>
              <Input
                className="mt-4"
                value={pickerQuery}
                onChange={(e) => setPickerQuery(e.target.value)}
                placeholder="Search installed apps"
                autoFocus
              />
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto p-3">
              {pickerLoading && <p className="p-3 text-[12.5px] text-slate-500">Loading apps...</p>}
              {pickerError && <p className="p-3 text-[12.5px] text-dangerInk">{pickerError}</p>}
              {!pickerLoading && !pickerError && filteredPickerItems.length === 0 && (
                <p className="p-3 text-[12.5px] text-slate-500">No installed apps found.</p>
              )}
              {!pickerLoading && !pickerError && (
                <ul className="flex flex-col gap-1">
                  {filteredPickerItems.map((item) => {
                    const key = appKey(item.app);
                    const alreadyAdded = existingAppKeys.has(key);
                    const isPicked = selectedApps.has(key);
                    const blockedByLimit = !isPicked && selectedApps.size >= remainingAppSlots;
                    const disabled = alreadyAdded || blockedByLimit;
                    return (
                      <li key={item.id}>
                        <label
                          className={cx(
                            'flex cursor-pointer items-center gap-3 rounded-lg px-3 py-2 transition',
                            disabled ? 'cursor-not-allowed opacity-55' : 'hover:bg-white/[0.05]',
                          )}
                        >
                          <input
                            type="checkbox"
                            className="h-4 w-4 accent-seal"
                            checked={isPicked || alreadyAdded}
                            disabled={disabled}
                            onChange={() => togglePickerItem(item)}
                          />
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-[12.5px] font-semibold text-slate-100">
                              {item.label}
                            </span>
                            <span className="mt-0.5 block truncate font-mono text-[10px] text-slate-450">
                              {appIdentifiers(item.app)}
                            </span>
                          </span>
                          {alreadyAdded && <Badge tone="neutral">Added</Badge>}
                        </label>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>

            <div className="flex justify-end gap-2 border-t border-white/[0.07] p-4">
              <Button variant="ghost" onClick={() => setPickerOpen(false)}>
                Cancel
              </Button>
              <Button onClick={addSelectedApps} disabled={selectedApps.size === 0}>
                Add selected
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
