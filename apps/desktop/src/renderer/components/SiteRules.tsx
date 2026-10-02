import { useState } from 'react';
import type { Policy, RuleAction, SiteAudience, SiteDefinition } from '@talysman/shared';
import { SITE_DEFINITIONS, effectiveSiteFeatures, sitesForAudiences } from '@talysman/shared';
import { Switch } from './ui/index.js';
import { cx, effectiveAction } from '../lib/utils.js';
import { useFocusStore } from '../store/useFocusStore.js';

const ACTION_LABELS: Record<RuleAction, string> = { allow: 'Allow', judge: 'AI', block: 'Hide' };

/** The site audiences this install belongs to (see `SiteDefinition.audience`). */
function siteAudiences(isLocalRelease: boolean, appEnv: string): ReadonlySet<SiteAudience> {
  const audiences = new Set<SiteAudience>();
  // Dev builds see everything so audience-limited sites can be worked on.
  if (isLocalRelease || appEnv !== 'production') audiences.add('local-release');
  return audiences;
}

function coversHost(entry: string, host: string): boolean {
  const base = entry.toLowerCase().replace(/^\*\./, '');
  return host === base || host.endsWith(`.${base}`);
}

/** Catalog sites this install offers, plus any already on (so they can be turned off). */
export function useListedSites(policy: Policy): SiteDefinition[] {
  const isLocalRelease = useFocusStore((s) => s.isLocalRelease);
  const appEnv = useFocusStore((s) => s.appEnv);
  const sites = policy.sites ?? {};
  const offered = new Set(sitesForAudiences(siteAudiences(isLocalRelease, appEnv)));
  return SITE_DEFINITIONS.filter((site) => offered.has(site) || sites[site.id]);
}

/** A site's features as they'll actually be enforced (AI resolved to its fallback when AI mode is off). */
function resolvedFeatures(site: SiteDefinition, policy: Policy, aiMode: boolean): Record<string, RuleAction> {
  return Object.fromEntries(
    Object.entries(effectiveSiteFeatures(site.id, policy.sites?.[site.id])).map(([id, action]) => [
      id,
      effectiveAction(action, policy, aiMode),
    ]),
  );
}

/** How many of a site's configurable features are hidden / left to the AI. */
export function siteRuleCounts(site: SiteDefinition, policy: Policy, aiMode: boolean) {
  const features = resolvedFeatures(site, policy, aiMode);
  const configurable = site.features.filter((feature) => !feature.locked);
  return {
    hidden: configurable.filter((feature) => features[feature.id] === 'block').length,
    judged: configurable.filter((feature) => features[feature.id] === 'judge').length,
  };
}

/**
 * Site rules ("soft blocks"): the catalog sites down the left, each with an on/off switch; the
 * selected site's features on the right. The site itself always stays reachable; turning it on
 * applies its catalog defaults — typically feeds and recommendations hidden, direct content,
 * search, and messaging shown — and each feature can then be set to Allow, AI (hidden page by
 * page when it doesn't fit your tasks), or Hide.
 * Everything here is rendered from the site catalog; there is no per-site UI code.
 */
export function SiteRules({
  policy,
  supported,
  aiMode,
  smartAllowed,
  limitReached,
  onSave,
  onError,
  onUpgrade,
}: {
  policy: Policy;
  /** False against a daemon that predates site rules. */
  supported: boolean;
  /** AI mode is on. Off ⇒ no AI option anywhere, and judged features show as their fallback. */
  aiMode: boolean;
  /** AI filtering is available (flag + plan). */
  smartAllowed: boolean;
  /** The plan's blocked-website allowance is used up. */
  limitReached: boolean;
  onSave: (next: Policy) => void;
  onError: (message: string) => void;
  onUpgrade: () => void;
}) {
  const sites = policy.sites ?? {};
  const listed = useListedSites(policy);
  const isLocalRelease = useFocusStore((s) => s.isLocalRelease);
  const appEnv = useFocusStore((s) => s.appEnv);
  // Universal soft block isn't ready to ship: dev and `release:local` builds only, plus any
  // install where it's already on so it can be turned off.
  const universalOffered = siteAudiences(isLocalRelease, appEnv).has('local-release') || Boolean(policy.universalSoftBlock);
  // Start on the first site that's on, so opening the section shows something to edit.
  const [selectedId, setSelectedId] = useState<string | null>(
    () => listed.find((site) => sites[site.id])?.id ?? listed[0]?.id ?? null,
  );
  const selected = listed.find((site) => site.id === selectedId) ?? listed[0];

  function toggleSite(site: SiteDefinition) {
    if (!supported) return;
    setSelectedId(site.id);
    if (sites[site.id]) {
      const { [site.id]: _removed, ...rest } = sites;
      onSave({ ...policy, sites: rest });
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

  if (!supported) {
    return <p className="text-caption text-slate-450">Update the Talysman desktop service to use soft blocks.</p>;
  }

  const rule = selected ? sites[selected.id] : undefined;
  const features = selected ? resolvedFeatures(selected, policy, aiMode) : {};
  const customized = rule && Object.keys(rule.features).length > 0;

  return (
    <>
      {universalOffered && (
        <div className="mb-4 flex items-center gap-4 rounded-[10px] border border-white/[0.10] p-4">
          <div className="min-w-0 flex-1">
            <p className="text-body font-semibold text-slate-100">Universal soft block <span className="text-caption text-slate-450">Experimental</span></p>
            <p className="mt-1 text-caption text-slate-400">After pages load, use AI to hide feeds, recommendations, and other distractions on sites without an enabled soft block. Learns each site independently.</p>
            <p className="mt-1 text-caption text-slate-450">Sends a compact page structure and short labels to your AI connection. Requires AI mode in Settings.{policy.universalSoftBlock && !aiMode ? ' Paused while AI mode is off.' : ''}</p>
          </div>
          <button
            type="button"
            role="switch"
            aria-checked={Boolean(policy.universalSoftBlock)}
            aria-label="Universal soft block"
            onClick={() => onSave({ ...policy, universalSoftBlock: !policy.universalSoftBlock })}
          >
            <Switch on={Boolean(policy.universalSoftBlock)} />
          </button>
        </div>
      )}
    <div className="grid grid-cols-[200px_minmax(0,1fr)] gap-4">
      <ul className="flex flex-col gap-0.5 border-r border-white/[0.06] pr-3">
        {listed.map((site) => {
          const on = Boolean(sites[site.id]);
          const isSelected = site.id === selected?.id;
          const { hidden } = siteRuleCounts(site, policy, aiMode);
          return (
            <li key={site.id}>
              <div
                className={cx(
                  'flex items-center gap-2 rounded-[8px] px-2.5 py-[5px] transition',
                  isSelected ? 'bg-white/[0.07]' : 'hover:bg-white/[0.035]',
                )}
              >
                <button
                  type="button"
                  onClick={() => setSelectedId(site.id)}
                  className="flex min-w-0 flex-1 items-baseline gap-2 text-left"
                >
                  <span className={cx('truncate text-body font-semibold', on ? 'text-slate-100' : 'text-slate-400')}>
                    {site.label}
                  </span>
                  {on && <span className="shrink-0 text-caption text-slate-500">{hidden} hidden</span>}
                </button>
                <button
                  type="button"
                  role="switch"
                  aria-checked={on}
                  aria-label={`Soft block ${site.label}`}
                  onClick={() => toggleSite(site)}
                >
                  <Switch on={on} className="scale-[0.85]" />
                </button>
              </div>
            </li>
          );
        })}
      </ul>

      {selected && (
        <div className="min-w-0">
          <div className="flex items-baseline gap-2.5">
            <span className="text-body font-semibold text-slate-100">{selected.label}</span>
            <span className="font-mono text-caption text-slate-500">{selected.hosts[0]}</span>
            {customized && (
              <button
                type="button"
                onClick={() => onSave({ ...policy, sites: { ...sites, [selected.id]: { features: {} } } })}
                className="ml-auto text-caption font-medium text-slate-450 transition hover:text-slate-200"
              >
                Reset to recommended
              </button>
            )}
          </div>

          {!rule ? (
            <div className="mt-3 rounded-[10px] border border-dashed border-white/[0.10] px-4 py-5 text-center">
              <p className="text-caption text-slate-400">
                Turn this on to keep using {selected.label} with its distracting parts hidden.
              </p>
              <button
                type="button"
                onClick={() => toggleSite(selected)}
                className="mt-2.5 text-caption font-semibold text-slate-100 transition hover:text-white"
              >
                {limitReached ? 'Upgrade to add more →' : `Soft block ${selected.label} →`}
              </button>
            </div>
          ) : (
            <ul className="mt-2 flex flex-col">
              {selected.features
                .filter((feature) => !feature.locked)
                .map((feature) => (
                  <li key={feature.id} className="flex items-center gap-3 border-b border-white/[0.05] py-2 last:border-b-0">
                    <span className="min-w-0 flex-1">
                      <span className="block text-body text-slate-250">{feature.label}</span>
                      {feature.description && (
                        <span className="block text-caption leading-snug text-slate-450">{feature.description}</span>
                      )}
                    </span>
                    <ActionPicker
                      value={features[feature.id] ?? effectiveAction(feature.default, policy, aiMode)}
                      aiMode={aiMode}
                      smartAllowed={smartAllowed}
                      onChange={(action) => setFeature(selected, feature.id, action)}
                    />
                  </li>
                ))}
            </ul>
          )}
        </div>
      )}
    </div>
    </>
  );
}

function ActionPicker({
  value,
  aiMode,
  smartAllowed,
  onChange,
}: {
  value: RuleAction;
  aiMode: boolean;
  smartAllowed: boolean;
  onChange: (action: RuleAction) => void;
}) {
  const actions: RuleAction[] = aiMode ? ['allow', 'judge', 'block'] : ['allow', 'block'];
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
            title={action === 'judge' ? 'Let the AI decide based on your tasks' : action === 'block' ? 'Hide this wherever it appears on the site' : undefined}
            onClick={() => value !== action && onChange(action)}
            className={cx(
              'px-2.5 py-1 text-caption font-semibold transition',
              value === action ? 'bg-white/[0.12] text-slate-100' : 'text-slate-450 hover:text-slate-200',
              locked && 'opacity-60',
            )}
          >
            {ACTION_LABELS[action]}
            {locked && <span className="ml-1 font-mono text-caption tracking-[0.08em] text-slate-450">PRO</span>}
          </button>
        );
      })}
    </span>
  );
}
