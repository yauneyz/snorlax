import { useState } from 'react';
import type { Policy, RuleAction, SiteDefinition } from '@talysman/shared';
import { SITE_DEFINITIONS, effectiveSiteFeatures } from '@talysman/shared';
import { Kicker } from './ui/index.js';
import { cx } from '../lib/utils.js';

const ACTION_LABELS: Record<RuleAction, string> = { allow: 'Allow', judge: 'AI', block: 'Block' };

function coversHost(entry: string, host: string): boolean {
  const base = entry.toLowerCase().replace(/^\*\./, '');
  return host === base || host.endsWith(`.${base}`);
}

/**
 * Site rules ("soft blocks"): one row per catalog site. Turning a site on applies its catalog
 * defaults — typically feeds and recommendations blocked, direct content, search, and messaging
 * allowed — and each feature can then be set to Allow, AI (judged against your tasks), or Block.
 * Everything here is rendered from the site catalog; there is no per-site UI code.
 */
export function SiteRules({
  policy,
  supported,
  smartAllowed,
  limitReached,
  onSave,
  onError,
  onUpgrade,
}: {
  policy: Policy;
  /** False against a daemon that predates site rules. */
  supported: boolean;
  /** AI filtering is available (flag + plan). */
  smartAllowed: boolean;
  /** The plan's blocked-website allowance is used up. */
  limitReached: boolean;
  onSave: (next: Policy) => void;
  onError: (message: string) => void;
  onUpgrade: () => void;
}) {
  const [expanded, setExpanded] = useState<string | null>(null);
  const sites = policy.sites ?? {};

  function toggleSite(site: SiteDefinition) {
    if (!supported) return;
    if (sites[site.id]) {
      const { [site.id]: _removed, ...rest } = sites;
      onSave({ ...policy, sites: rest });
      if (expanded === site.id) setExpanded(null);
      return;
    }
    if (limitReached) {
      onUpgrade();
      return;
    }
    // A hard block on exactly the site's host is replaced by the site rule; anything broader
    // (e.g. a wildcard over a parent domain) would keep blocking it, so ask the user to decide.
    const primary = site.hosts[0] ?? '';
    const covering = policy.blockedDomains.filter((entry) => site.hosts.some((host) => coversHost(entry, host)));
    if (covering.some((entry) => !site.hosts.includes(entry.toLowerCase().replace(/^\*\./, '')))) {
      onError(`Remove the broader hard block covering ${primary} before adding site rules for ${site.label}.`);
      return;
    }
    onSave({
      ...policy,
      blockedDomains: policy.blockedDomains.filter((entry) => !covering.includes(entry)),
      sites: { ...sites, [site.id]: { features: {} } },
    });
    setExpanded(site.id);
  }

  function setFeature(site: SiteDefinition, featureId: string, action: RuleAction) {
    const rule = sites[site.id];
    if (!rule) return;
    if (action === 'judge' && !smartAllowed) {
      onUpgrade();
      return;
    }
    const feature = site.features.find((f) => f.id === featureId);
    const features = { ...rule.features };
    // Store only departures from the catalog default so improved defaults reach the user.
    if (feature && feature.default === action) delete features[featureId];
    else features[featureId] = action;
    onSave({ ...policy, sites: { ...sites, [site.id]: { features } } });
  }

  return (
    <div className="mt-6">
      <div className="flex items-baseline gap-2.5">
        <Kicker>Site rules</Kicker>
        <span className="text-[11px] text-slate-600">
          {Object.keys(sites).length}/{SITE_DEFINITIONS.length} on
        </span>
      </div>
      <p className="mt-1 text-[11px] leading-snug text-slate-400">
        {supported
          ? 'Keep the useful parts of a site — search, messages, posting, a specific post — while its feeds and recommendations stay blocked. Loosening a rule needs your key while focus is on.'
          : 'Update the Talysman desktop service to use site rules.'}
      </p>
      <div className="mt-2.5 flex flex-col gap-1.5">
        {SITE_DEFINITIONS.map((site) => {
          const rule = sites[site.id];
          const enabled = Boolean(rule);
          const open = enabled && expanded === site.id;
          const features = effectiveSiteFeatures(site.id, rule);
          const configurable = site.features.filter((feature) => !feature.locked);
          const blockedCount = configurable.filter((feature) => features[feature.id] === 'block').length;
          const judgedCount = configurable.filter((feature) => features[feature.id] === 'judge').length;
          return (
            <div
              key={site.id}
              className={cx(
                'rounded-[10px] border transition',
                enabled ? 'border-seal/30 bg-seal/[0.06]' : 'border-white/[0.07] bg-white/[0.025]',
                !supported && 'opacity-50',
              )}
            >
              <div className="flex items-center gap-3 px-3 py-2.5">
                <button
                  type="button"
                  onClick={() => enabled && setExpanded(open ? null : site.id)}
                  disabled={!enabled}
                  aria-expanded={open}
                  className="flex min-w-0 flex-1 items-center gap-2 text-left"
                >
                  <span className="text-[12.5px] font-semibold text-slate-250">{site.label}</span>
                  {enabled && (
                    <span className="truncate text-[11px] text-slate-450">
                      {blockedCount} blocked{judgedCount > 0 ? ` · ${judgedCount} AI` : ''} · {open ? 'hide' : 'customize'}
                    </span>
                  )}
                </button>
                <button
                  type="button"
                  role="switch"
                  aria-checked={enabled}
                  aria-label={`Site rules for ${site.label}`}
                  onClick={() => toggleSite(site)}
                  disabled={!supported}
                  className="text-[11px] font-medium text-slate-400 transition hover:text-slate-200"
                >
                  {enabled ? 'On' : limitReached ? 'Upgrade' : 'Off'}
                </button>
              </div>
              {open && (
                <ul className="flex flex-col gap-1 border-t border-white/[0.06] px-3 py-2">
                  {configurable.map((feature) => (
                    <li key={feature.id} className="flex items-center gap-3 py-1">
                      <span className="min-w-0 flex-1">
                        <span className="block text-[12px] text-slate-250">{feature.label}</span>
                        {feature.description && (
                          <span className="block text-[10.5px] leading-snug text-slate-450">{feature.description}</span>
                        )}
                      </span>
                      <ActionPicker
                        value={features[feature.id] ?? feature.default}
                        smartAllowed={smartAllowed}
                        onChange={(action) => setFeature(site, feature.id, action)}
                      />
                    </li>
                  ))}
                </ul>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function ActionPicker({
  value,
  smartAllowed,
  onChange,
}: {
  value: RuleAction;
  smartAllowed: boolean;
  onChange: (action: RuleAction) => void;
}) {
  const actions: RuleAction[] = ['allow', 'judge', 'block'];
  return (
    <span role="radiogroup" className="flex shrink-0 overflow-hidden rounded-full border border-white/[0.10]">
      {actions.map((action) => {
        const locked = action === 'judge' && !smartAllowed && value !== 'judge';
        return (
          <button
            key={action}
            type="button"
            role="radio"
            aria-checked={value === action}
            title={action === 'judge' ? 'Let the AI decide based on your tasks' : undefined}
            onClick={() => value !== action && onChange(action)}
            className={cx(
              'px-2.5 py-1 text-[10.5px] font-semibold transition',
              value === action ? 'bg-white/[0.12] text-slate-100' : 'text-slate-450 hover:text-slate-200',
              locked && 'opacity-60',
            )}
          >
            {ACTION_LABELS[action]}
            {locked && <span className="ml-1 font-mono text-[9px] tracking-[0.08em] text-slate-450">PRO</span>}
          </button>
        );
      })}
    </span>
  );
}
