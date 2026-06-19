import React, { useState } from 'react';
import type { Mode, Policy } from '@focuslock/shared';
import { siblingsFor } from '@focuslock/core/browser';
import { request } from '../lib/bridge.js';
import { useFocusStore } from '../store/useFocusStore.js';
import { Badge, Button, Card, CardTitle, Input } from '../components/ui/index.js';
import { cx } from '../lib/utils.js';
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

export function Blocklists({ onUpgrade }: { onUpgrade: () => void }) {
  const policy = useFocusStore((s) => s.policy);
  const productLimits = useFocusStore((s) => s.productLimits);
  const refresh = useFocusStore((s) => s.refresh);
  const [domain, setDomain] = useState('');
  const [appName, setAppName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const allowedModes = allowedPolicyModes(productLimits);
  const maxDomains = maxPolicyDomains(productLimits);
  const maxApps = maxPolicyApps(productLimits);
  const domainLimitReached = maxDomains !== null && policy.domains.length >= maxDomains;
  const appBlockingLocked = maxApps === 0;

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
  const removeApp = (label: string) =>
    save({ ...policy, apps: policy.apps.filter((a) => a.label !== label) });

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
              <Input
                value={appName}
                onChange={(e) => setAppName(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && addApp()}
                placeholder="chrome.exe"
                disabled={maxApps !== null && policy.apps.length >= maxApps}
              />
              <Button onClick={addApp} disabled={maxApps !== null && policy.apps.length >= maxApps}>
                Add
              </Button>
            </div>
            <ul className="flex flex-col gap-2">
              {policy.apps.map((a) => (
                <li key={a.label} className="flex items-center justify-between rounded-lg bg-panel2 px-3 py-2">
                  <span className="text-sm text-slate-200">
                    {a.label} {a.windowsImageName && <Badge tone="neutral">{a.windowsImageName}</Badge>}
                    {a.linuxProcessName && <Badge tone="neutral">{a.linuxProcessName}</Badge>}
                  </span>
                  <button onClick={() => removeApp(a.label)} className="text-xs text-red-400 hover:underline">
                    remove
                  </button>
                </li>
              ))}
              {policy.apps.length === 0 && <p className="text-sm text-slate-500">No apps yet.</p>}
            </ul>
          </>
        )}
      </Card>

      {error && <p className="text-sm text-red-400 lg:col-span-2">{error}</p>}
    </div>
  );
}
