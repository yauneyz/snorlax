import React, { useMemo, useState } from 'react';
import type { AppRef, Mode, Policy } from '@focuslock/shared';
import { siblingsFor } from '@focuslock/core/browser';
import { listInstalledApps, request } from '../lib/bridge.js';
import { useFocusStore } from '../store/useFocusStore.js';
import { Badge, Button, Card, CardTitle, Input } from '../components/ui/index.js';
import { cx } from '../lib/utils.js';
import type { AppPickerItem } from '../../shared/appPicker.js';
import {
  allowedPolicyModes,
  maxPolicyApps,
  maxPolicyDomains,
} from '../../shared/productLimits.js';

const MODES: { value: Mode; label: string; hint: string }[] = [
  { value: 'blacklist', label: 'Blacklist', hint: 'Block only the listed sites.' },
  { value: 'whitelist', label: 'Whitelist', hint: 'Block everything except the listed sites/apps.' },
  { value: 'block-all', label: 'Block all', hint: 'Total internet block.' },
];

function appKey(app: AppRef): string {
  return [
    app.windowsImageName?.toLowerCase() ?? '',
    app.linuxProcessName?.toLowerCase() ?? '',
    app.macBundleId ?? '',
  ].join('|');
}

function appBadges(app: AppRef) {
  return (
    <>
      {app.windowsImageName && <Badge tone="neutral">{app.windowsImageName}</Badge>}
      {app.linuxProcessName && <Badge tone="neutral">{app.linuxProcessName}</Badge>}
      {app.macBundleId && <Badge tone="neutral">{app.macBundleId}</Badge>}
    </>
  );
}

export function Blocklists({ onUpgrade }: { onUpgrade: () => void }) {
  const policy = useFocusStore((s) => s.policy);
  const productLimits = useFocusStore((s) => s.productLimits);
  const refresh = useFocusStore((s) => s.refresh);
  const [domain, setDomain] = useState('');
  const [appName, setAppName] = useState('');
  const [pickerOpen, setPickerOpen] = useState(false);
  const [pickerLoading, setPickerLoading] = useState(false);
  const [pickerError, setPickerError] = useState<string | null>(null);
  const [pickerItems, setPickerItems] = useState<AppPickerItem[]>([]);
  const [pickerQuery, setPickerQuery] = useState('');
  const [selectedApps, setSelectedApps] = useState<Set<string>>(() => new Set());
  const [error, setError] = useState<string | null>(null);
  const allowedModes = allowedPolicyModes(productLimits);
  const maxDomains = maxPolicyDomains(productLimits);
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

  async function save(next: Policy) {
    setError(null);
    try {
      await request('setPolicy', { policy: next });
      await refresh();
    } catch (e) {
      setError((e as Error).message);
    }
  }

  const setMode = (mode: Mode) => save({ ...policy, mode });
  const addDomain = () => {
    if (!domain.trim()) return;
    if (domainLimitReached) return setError(`Free supports up to ${maxDomains} blocked websites.`);
    save({ ...policy, domains: [...policy.domains, domain.trim()] });
    setDomain('');
  };
  const removeDomain = (d: string) => save({ ...policy, domains: policy.domains.filter((x) => x !== d) });
  const addApp = () => {
    if (!appName.trim()) return;
    if (maxApps !== null && policy.apps.length >= maxApps) {
      return setError('Free does not include app blocking.');
    }
    const name = appName.trim();
    save({
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

  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
      <Card className="lg:col-span-2">
        <CardTitle hint="How the service decides what to block.">Mode</CardTitle>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          {MODES.map((m) => {
            const locked = Boolean(allowedModes && !allowedModes.includes(m.value));
            return (
              <button
                key={m.value}
                onClick={() => (locked ? onUpgrade() : setMode(m.value))}
                aria-disabled={locked}
                className={cx(
                  'rounded-lg border p-4 text-left transition',
                  policy.mode === m.value
                    ? 'border-accent bg-accent/10'
                    : 'border-border bg-panel2 hover:border-slate-500',
                  locked && 'opacity-65',
                )}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="font-semibold text-white">{m.label}</span>
                  {locked && <Badge tone="neutral">Pro</Badge>}
                </div>
                <div className="mt-1 text-xs text-slate-400">{m.hint}</div>
              </button>
            );
          })}
        </div>
      </Card>

      <Card>
        <CardTitle hint='Wildcards allowed as a leading "*." (e.g. *.reddit.com).'>Blocked domains</CardTitle>
        <div className="mb-3 flex gap-2">
          <Input
            value={domain}
            onChange={(e) => setDomain(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && addDomain()}
            placeholder="youtube.com"
            disabled={domainLimitReached}
          />
          <Button onClick={addDomain} disabled={domainLimitReached}>
            Add
          </Button>
        </div>
        {maxDomains !== null && (
          <p className="mb-3 text-xs text-slate-500">
            {policy.domains.length}/{maxDomains} websites
          </p>
        )}
        <ul className="flex flex-col gap-2">
          {policy.domains.map((d) => {
            const siblings = siblingsFor(d);
            return (
              <li key={d} className="rounded-lg bg-panel2 px-3 py-2">
                <div className="flex items-center justify-between">
                  <span className="text-sm text-slate-200">{d}</span>
                  <button onClick={() => removeDomain(d)} className="text-xs text-red-400 hover:underline">
                    remove
                  </button>
                </div>
                {siblings.length > 0 && (
                  <p className="mt-1 text-xs text-slate-500">also blocks: {siblings.join(', ')}</p>
                )}
              </li>
            );
          })}
          {policy.domains.length === 0 && <p className="text-sm text-slate-500">No domains yet.</p>}
        </ul>
      </Card>

      <Card>
        <div className="mb-3 flex items-start justify-between gap-3">
          <CardTitle hint="Matched by executable name on Windows (e.g. chrome.exe).">
            Blocked apps
          </CardTitle>
          {appBlockingLocked && <Badge tone="neutral">Pro</Badge>}
        </div>
        {appBlockingLocked ? (
          <div>
            <div className="mb-3 flex gap-2">
              <Input value="" placeholder="chrome.exe" disabled />
              <Button disabled>Add</Button>
            </div>
            <Button variant="ghost" onClick={onUpgrade}>
              Upgrade for app blocking
            </Button>
          </div>
        ) : (
          <>
            <div className="mb-3 flex gap-2">
              <Button onClick={openAppPicker} disabled={appLimitReached}>
                Choose apps
              </Button>
            </div>
            <div className="mb-3 flex gap-2">
              <Input
                value={appName}
                onChange={(e) => setAppName(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && addApp()}
                placeholder="Manual entry, e.g. chrome.exe or chrome"
                disabled={appLimitReached}
              />
              <Button onClick={addApp} disabled={appLimitReached}>
                Add
              </Button>
            </div>
            {maxApps !== null && (
              <p className="mb-3 text-xs text-slate-500">
                {policy.apps.length}/{maxApps} apps
              </p>
            )}
            <ul className="flex flex-col gap-2">
              {policy.apps.map((a) => (
                <li key={appKey(a)} className="flex items-center justify-between gap-3 rounded-lg bg-panel2 px-3 py-2">
                  <span className="flex flex-wrap items-center gap-2 text-sm text-slate-200">
                    {a.label} {appBadges(a)}
                  </span>
                  <button onClick={() => removeApp(a)} className="text-xs text-red-400 hover:underline">
                    remove
                  </button>
                </li>
              ))}
              {policy.apps.length === 0 && <p className="text-sm text-slate-500">No apps yet.</p>}
            </ul>
          </>
        )}
      </Card>

      {pickerOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 px-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="app-picker-title"
        >
          <div className="flex max-h-[82vh] w-full max-w-2xl flex-col rounded-xl border border-border bg-panel shadow-2xl">
            <div className="border-b border-border p-5">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <h2 id="app-picker-title" className="text-lg font-semibold text-white">
                    Choose apps
                  </h2>
                  <p className="mt-1 text-sm text-slate-400">
                    {selectedApps.size} selected
                    {maxApps !== null ? ` - ${remainingAppSlots} slots available` : ''}
                  </p>
                </div>
                <button
                  onClick={() => setPickerOpen(false)}
                  className="rounded-lg px-2 py-1 text-sm text-slate-400 hover:bg-panel2 hover:text-white"
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
              {pickerLoading && <p className="p-3 text-sm text-slate-500">Loading apps...</p>}
              {pickerError && <p className="p-3 text-sm text-red-400">{pickerError}</p>}
              {!pickerLoading && !pickerError && filteredPickerItems.length === 0 && (
                <p className="p-3 text-sm text-slate-500">No installed apps found.</p>
              )}
              {!pickerLoading && !pickerError && (
                <ul className="flex flex-col gap-1">
                  {filteredPickerItems.map((item) => {
                    const key = appKey(item.app);
                    const alreadyAdded = existingAppKeys.has(key);
                    const selected = selectedApps.has(key);
                    const blockedByLimit = !selected && selectedApps.size >= remainingAppSlots;
                    const disabled = alreadyAdded || blockedByLimit;
                    return (
                      <li key={item.id}>
                        <label
                          className={cx(
                            'flex cursor-pointer items-center gap-3 rounded-lg px-3 py-2 transition',
                            disabled ? 'cursor-not-allowed opacity-55' : 'hover:bg-panel2',
                          )}
                        >
                          <input
                            type="checkbox"
                            className="h-4 w-4"
                            checked={selected || alreadyAdded}
                            disabled={disabled}
                            onChange={() => togglePickerItem(item)}
                          />
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-sm font-medium text-slate-100">
                              {item.label}
                            </span>
                            <span className="mt-1 flex flex-wrap gap-2">{appBadges(item.app)}</span>
                          </span>
                          {alreadyAdded && <Badge tone="neutral">Added</Badge>}
                        </label>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>

            <div className="flex justify-end gap-2 border-t border-border p-4">
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

      {error && <p className="text-sm text-red-400 lg:col-span-2">{error}</p>}
    </div>
  );
}
