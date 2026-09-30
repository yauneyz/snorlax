import React, { useMemo, useState } from 'react';
import type { AppRef, Policy, PremadeListId, Profile } from '@talysman/shared';
import { PREMADE_LISTS, palette } from '@talysman/shared';
import { productFeaturesForEnvironment } from '@talysman/product';
import {
  EMPTY_POLICY,
  MAX_PROFILE_NAME_LENGTH,
  emptyProfileConfig,
  newProfileId,
  nextProfileColor,
} from '@talysman/shared';
import { siblingsFor } from '@talysman/core/browser';
import { listInstalledApps } from '../lib/bridge.js';
import { runCommand, saveProfile as saveProfileCommand } from '../lib/engine.js';
import { PoolEditor, poolSummary } from '../components/PoolEditor.js';
import { BlocklistSection } from '../components/BlocklistSection.js';
import { ProfileSwitch } from '../components/ProfileList.js';
import { desktopPaletteColor } from '../lib/desktopPalette.js';
import { useFocusStore } from '../store/useFocusStore.js';
import { Badge, Button, Input, Kicker, ProfileDot, Switch, Textarea } from '../components/ui/index.js';
import { cx, effectiveAction, profileSummary } from '../lib/utils.js';
import { SiteRules, siteRuleCounts, useListedSites } from '../components/SiteRules.js';
import { JudgeSettings } from '../components/JudgeSettings.js';
import type { AppPickerItem } from '../../shared/appPicker.js';
import {
  maxAllowedDomains,
  maxBlockedDomains,
  maxPolicyApps,
  maxProfiles,
  premadeListsAllowed,
  smartFilteringAllowed,
} from '../../shared/productLimits.js';

const TOTAL_PREMADE_DOMAINS = PREMADE_LISTS.reduce((sum, list) => sum + list.domainCount, 0);

const SMART_FILTERING_ENABLED = productFeaturesForEnvironment(
  __APP_CONFIG__.APP_ENV,
).smartFiltering;

/** Page-level indicators follow the desktop app's signal color; profile colours stay in the switcher. */
const BLOCKLIST_SIGNAL = desktopPaletteColor('signal');

type SectionId = 'ai' | 'hard' | 'soft' | 'premade' | 'apps' | 'pools';

function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? '' : 's'}`;
}

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

/** One row in a domain list, with the sibling hosts it also covers. */
function DomainRow({
  d,
  accent,
  onRemove,
}: {
  d: string;
  accent: string;
  onRemove: (d: string) => void;
}) {
  const siblings = siblingsFor(d);
  return (
    <div className="flex items-center gap-2.5 bg-panel px-3 py-[7px]">
      <span
        className="block h-[5px] w-[5px] shrink-0 rounded-full"
        style={{ backgroundColor: accent }}
      />
      <span className="min-w-0 flex-1 truncate font-mono text-[12px] text-slate-200">{d}</span>
      {siblings.length > 0 && (
        <span
          className="max-w-[40%] truncate text-[10.5px] text-slate-500"
          title={siblings.join(', ')}
        >
          also {siblings.join(', ')}
        </span>
      )}
      <button
        onClick={() => onRemove(d)}
        aria-label={`Remove ${d}`}
        className="shrink-0 px-1 text-[13px] leading-none text-slate-500 transition hover:text-dangerInk"
      >
        ×
      </button>
    </div>
  );
}

/**
 * One "Always block" / "Always allow" list, edited in place: add one, paste many, and a search box
 * once the list is long enough to need one.
 */
function DomainListEditor({
  title,
  hint,
  placeholder,
  accent,
  domains,
  onAdd,
  onAddMany,
  onRemove,
  max,
  limitReached,
}: {
  title: string;
  hint: string;
  placeholder: string;
  accent: string;
  domains: string[];
  onAdd: (d: string) => void;
  onAddMany: (domains: string[]) => void;
  onRemove: (d: string) => void;
  max: number | null;
  limitReached: boolean;
}) {
  const [input, setInput] = useState('');
  const [query, setQuery] = useState('');
  const [pasteOpen, setPasteOpen] = useState(false);
  const [pasteText, setPasteText] = useState('');
  const searchable = domains.length > 8;

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return domains;
    return domains.filter((d) => d.toLowerCase().includes(q));
  }, [domains, query]);

  function submit() {
    const trimmed = input.trim();
    if (!trimmed) return;
    onAdd(trimmed);
    setInput('');
  }

  function submitPaste() {
    const parsed = pasteText
      .split(/[\n,\s]+/)
      .map((s) => s.trim())
      .filter(Boolean);
    if (parsed.length === 0) return;
    onAddMany(parsed);
    setPasteText('');
    setPasteOpen(false);
  }

  return (
    <div className="min-w-0">
      <div className="flex items-baseline gap-2">
        <span className="text-[12.5px] font-semibold text-slate-200">{title}</span>
        <span className="font-mono text-[10.5px] text-slate-500">
          {max === null ? domains.length : `${domains.length}/${max}`}
        </span>
        <span className="ml-auto truncate text-[10.5px] text-slate-500">{hint}</span>
      </div>

      <div className="mt-2 flex gap-2">
        <Input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && submit()}
          placeholder={placeholder}
          disabled={limitReached}
          className="py-1.5 font-mono"
        />
        <Button onClick={submit} disabled={limitReached} className="shrink-0 px-4 py-1.5">
          Add
        </Button>
      </div>

      {pasteOpen && (
        <div className="mt-2">
          <Textarea
            rows={4}
            value={pasteText}
            onChange={(e) => setPasteText(e.target.value)}
            placeholder={'One per line, or comma-separated\nreddit.com\nyoutube.com'}
            disabled={limitReached}
            autoFocus
            className="font-mono"
          />
          <div className="mt-1.5 flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setPasteOpen(false)} className="px-3 py-1 text-[11.5px]">
              Cancel
            </Button>
            <Button onClick={submitPaste} disabled={limitReached || !pasteText.trim()} className="px-3 py-1 text-[11.5px]">
              Add all
            </Button>
          </div>
        </div>
      )}

      <div className="mt-2 flex items-center gap-3">
        {searchable && (
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={`Search ${domains.length} sites`}
            className="py-1 text-[11.5px]"
          />
        )}
        {!pasteOpen && (
          <button
            onClick={() => setPasteOpen(true)}
            disabled={limitReached}
            className="shrink-0 text-[11px] font-medium text-slate-450 transition hover:text-slate-200 disabled:opacity-45"
          >
            Paste many
          </button>
        )}
      </div>

      <div className="mt-2 max-h-[280px] overflow-y-auto rounded-[10px] border border-white/[0.06] bg-white/[0.05]">
        <div className="flex flex-col gap-px">
          {filtered.map((d) => (
            <DomainRow key={d} d={d} accent={accent} onRemove={onRemove} />
          ))}
          {filtered.length === 0 && (
            <p className="bg-panel px-3 py-2.5 text-[11.5px] text-slate-500">
              {domains.length === 0 ? 'No sites yet.' : 'No matches.'}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

export function Blocklists({ onUpgrade }: { onUpgrade: () => void }) {
  const profiles = useFocusStore((s) => s.profiles);
  const engine = useFocusStore((s) => s.engine);
  const defaultProfileId = useFocusStore((s) => s.defaultProfileId);
  const pairedKeys = useFocusStore((s) => s.pairedKeys);
  const setOverridesOpen = useFocusStore((s) => s.setOverridesOpen);
  const keyPresent = useFocusStore((s) => s.keyPresent);
  const productLimits = useFocusStore((s) => s.productLimits);
  const aiMode = useFocusStore((s) => s.aiMode);
  // Which profile the editor is pointed at. `null` shows the default profile.
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [openSection, setOpenSection] = useState<SectionId | null>(null);
  // "Block everything" empties the allow list, so with sites on it the button asks once first.
  const [confirmBlockAll, setConfirmBlockAll] = useState(false);
  const [appName, setAppName] = useState('');
  const [pickerOpen, setPickerOpen] = useState(false);
  const [pickerLoading, setPickerLoading] = useState(false);
  const [pickerError, setPickerError] = useState<string | null>(null);
  const [pickerItems, setPickerItems] = useState<AppPickerItem[]>([]);
  const [pickerQuery, setPickerQuery] = useState('');
  const [selectedApps, setSelectedApps] = useState<Set<string>>(() => new Set());
  const [error, setError] = useState<string | null>(null);

  const selected =
    profiles.find((p) => p.id === selectedId) ?? profiles.find((p) => p.id === defaultProfileId) ?? profiles[0];
  const policy = selected?.config.policy ?? EMPTY_POLICY;
  const sitesSupported = true;
  const isOn = (id: string | undefined) =>
    engine.profiles.some((p) => p.profile.id === id && (p.activation.active || p.activation.paused));
  const isActive = isOn(selected?.id);
  const accent = BLOCKLIST_SIGNAL;
  const profileLimit = maxProfiles(productLimits);
  const profileLimitReached = profileLimit !== null && profiles.length >= profileLimit;

  const maxBlocked = maxBlockedDomains(productLimits);
  const maxAllowed = maxAllowedDomains(productLimits);
  const maxApps = maxPolicyApps(productLimits);
  const smartAllowed = aiMode && smartFilteringAllowed(productLimits);
  const classicMode = policy.defaultAction === 'allow' ? 'blacklist' : 'whitelist';
  const classicDomains =
    classicMode === 'blacklist' ? policy.blockedDomains : policy.allowedDomains;
  // Site rules share the blocked-website allowance with the hard block list.
  const blockedEntryCount = policy.blockedDomains.length + Object.keys(policy.sites ?? {}).length;
  const blockedLimitReached = maxBlocked !== null && blockedEntryCount >= maxBlocked;
  const allowedLimitReached = maxAllowed !== null && policy.allowedDomains.length >= maxAllowed;
  const appBlockingLocked = maxApps === 0;
  const premadeListsLocked = !premadeListsAllowed(productLimits);
  const enabledPremade = useMemo(
    () =>
      premadeListsLocked
        ? []
        : PREMADE_LISTS.filter((list) => policy.enabledPremadeLists.includes(list.id)),
    [premadeListsLocked, policy.enabledPremadeLists],
  );
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

  /** Every edit on this page writes one whole profile; the service gates any loosening. */
  async function saveProfile(next: Profile): Promise<boolean> {
    setError(null);
    try {
      await saveProfileCommand(next);
      return true;
    } catch (e) {
      setError((e as Error).message);
      return false;
    }
  }

  async function save(next: Policy) {
    if (!selected) return;
    await saveProfile({ ...selected, config: { ...selected.config, policy: next } });
  }

  async function savePools(pools: Profile['config']['pools']) {
    if (!selected) return;
    await saveProfile({ ...selected, config: { ...selected.config, pools } });
  }

  async function addProfile() {
    if (profileLimitReached) return onUpgrade();
    const id = newProfileId();
    const ok = await saveProfile({
      id,
      name: `Profile ${profiles.length + 1}`,
      color: nextProfileColor(profiles),
      createdAtMs: Date.now(),
      config: emptyProfileConfig(),
      latch: { state: 'off' },
    });
    if (ok) setSelectedId(id);
  }

  /** Copy the selected profile's whole config (pools and schedule too) under a new id. */
  async function duplicateProfile() {
    if (!selected) return;
    if (profileLimitReached) return onUpgrade();
    const newId = newProfileId();
    await runProfileRequest(async () => {
      await runCommand({ type: 'duplicateProfile', profileId: selected.id, newId, color: nextProfileColor(profiles) });
      setSelectedId(newId);
    });
  }

  async function renameProfile(name: string) {
    const trimmed = name.trim().slice(0, MAX_PROFILE_NAME_LENGTH);
    if (!selected || !trimmed || trimmed === selected.name) return;
    await saveProfile({ ...selected, name: trimmed });
  }

  async function runProfileRequest(run: () => Promise<unknown>) {
    setError(null);
    try {
      await run();
    } catch (e) {
      setError((e as Error).message);
    }
  }

  const deleteProfile = (profileId: string) =>
    runProfileRequest(async () => {
      await runCommand({ type: 'deleteProfile', profileId });
      if (selectedId === profileId) setSelectedId(null);
    });

  const turnOn = (profileId: string) => runProfileRequest(() => runCommand({ type: 'setLatch', profileId, on: true }));

  const makeDefault = (profileId: string) =>
    runProfileRequest(() => runCommand({ type: 'setDefaultProfile', profileId }));

  const toggleSection = (id: SectionId) => {
    setOpenSection((current) => (current === id ? null : id));
    setConfirmBlockAll(false);
  };

  /** The hard-blocks switch: what happens to a site that's on neither list. */
  function setUnlisted(action: 'allow' | 'block' | 'judge') {
    if (action === 'judge') {
      if (!smartAllowed) return onUpgrade();
      // Without a task the judge has nothing to judge against; send them to the AI filter.
      if (!policy.judge) {
        setOpenSection('ai');
        return setError('Add what you’re working on to the AI filter first.');
      }
      return save({ ...policy, defaultAction: 'judge' });
    }
    if (SMART_FILTERING_ENABLED) return save({ ...policy, defaultAction: action });
    // Classic builds keep one list: it moves between block and allow as the mode flips.
    return save(
      action === 'allow'
        ? { ...policy, blockedDomains: classicDomains, allowedDomains: [], defaultAction: 'allow' }
        : { ...policy, blockedDomains: [], allowedDomains: classicDomains, defaultAction: 'block' },
    );
  }

  /** The whole internet, off. Keeps the block list (it's moot, and useful again later). */
  function blockEverything() {
    if (policy.allowedDomains.length > 0 && !confirmBlockAll) return setConfirmBlockAll(true);
    setConfirmBlockAll(false);
    return save({
      ...policy,
      blockedDomains: SMART_FILTERING_ENABLED ? policy.blockedDomains : [],
      allowedDomains: [],
      defaultAction: 'block',
    });
  }

  const addBlockedDomain = (domain: string) => {
    if (blockedLimitReached) {
      return setError(`Free supports up to ${maxBlocked} blocked websites.`);
    }
    void save({
      ...policy,
      blockedDomains: [...policy.blockedDomains, domain],
      allowedDomains: SMART_FILTERING_ENABLED ? policy.allowedDomains : [],
    });
  };
  const removeBlockedDomain = (d: string) =>
    save({
      ...policy,
      blockedDomains: policy.blockedDomains.filter((x) => x !== d),
      allowedDomains: SMART_FILTERING_ENABLED ? policy.allowedDomains : [],
    });
  /** Pasting a big list into the edit modal — dedupes against what's already there and stops at the plan limit. */
  const addManyBlockedDomains = (raw: string[]) => {
    const room = maxBlocked === null ? Infinity : maxBlocked - blockedEntryCount;
    const existing = new Set(policy.blockedDomains);
    const additions = [...new Set(raw)].filter((d) => d && !existing.has(d)).slice(0, room);
    if (additions.length === 0) return;
    void save({
      ...policy,
      blockedDomains: [...policy.blockedDomains, ...additions],
      allowedDomains: SMART_FILTERING_ENABLED ? policy.allowedDomains : [],
    });
  };

  const addAllowedDomain = (domain: string) => {
    if (allowedLimitReached) {
      return setError(`Free supports up to ${maxAllowed} allowed websites.`);
    }
    void save({
      ...policy,
      blockedDomains: SMART_FILTERING_ENABLED ? policy.blockedDomains : [],
      allowedDomains: [...policy.allowedDomains, domain],
    });
    setConfirmBlockAll(false);
  };
  const removeAllowedDomain = (d: string) =>
    save({
      ...policy,
      blockedDomains: SMART_FILTERING_ENABLED ? policy.blockedDomains : [],
      allowedDomains: policy.allowedDomains.filter((x) => x !== d),
    });
  const addManyAllowedDomains = (raw: string[]) => {
    const room = maxAllowed === null ? Infinity : maxAllowed - policy.allowedDomains.length;
    const existing = new Set(policy.allowedDomains);
    const additions = [...new Set(raw)].filter((d) => d && !existing.has(d)).slice(0, room);
    if (additions.length === 0) return;
    void save({
      ...policy,
      blockedDomains: SMART_FILTERING_ENABLED ? policy.blockedDomains : [],
      allowedDomains: [...policy.allowedDomains, ...additions],
    });
  };

  const togglePremadeList = (id: PremadeListId) => {
    if (premadeListsLocked) return onUpgrade();
    const enabled = policy.enabledPremadeLists.includes(id);
    void save({
      ...policy,
      enabledPremadeLists: enabled
        ? policy.enabledPremadeLists.filter((x) => x !== id)
        : [...policy.enabledPremadeLists, id],
    });
  };

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

  // ── Collapsed-row summaries ──────────────────────────────────────────────────────────────
  const unlisted = effectiveAction(policy.defaultAction, policy, aiMode);
  const blockingEverything = unlisted === 'block' && policy.allowedDomains.length === 0;
  const unlistedLabel = { allow: 'allowed', block: 'blocked', judge: 'checked by AI' }[unlisted];
  const hardSummary = SMART_FILTERING_ENABLED
    ? blockingEverything
      ? 'Blocking the whole internet'
      : `Everything else ${unlistedLabel} · ${policy.blockedDomains.length} blocked · ${policy.allowedDomains.length} allowed`
    : classicMode === 'blacklist'
      ? `Blocking ${plural(classicDomains.length, 'site')}`
      : blockingEverything
        ? 'Blocking the whole internet'
        : `Allowing only ${plural(classicDomains.length, 'site')}`;
  const hardChips = unlisted === 'allow' ? policy.blockedDomains : policy.allowedDomains;

  const listedSites = useListedSites(policy);
  const softOn = listedSites.filter((site) => policy.sites?.[site.id]);
  const softCounts = softOn.map((site) => siteRuleCounts(site, policy, aiMode));
  const softHidden = softCounts.reduce((sum, c) => sum + c.hidden, 0);
  const softJudged = softCounts.reduce((sum, c) => sum + c.judged, 0);
  const softSummary =
    softOn.length === 0
      ? `Off · ${listedSites.length} sites available`
      : `${softOn.length} of ${listedSites.length} sites · ${softHidden} features hidden${softJudged ? ` · ${softJudged} AI` : ''}`;

  const judge = policy.judge;
  const aiSummary = !judge
    ? 'Off · describe what you’re working on'
    : [
        plural(judge.tasks.length, 'task'),
        judge.avoid.length > 0 && `avoiding ${judge.avoid.length}`,
        unlisted === 'judge'
          ? 'checking unlisted sites'
          : softJudged > 0
            ? `checking ${plural(softJudged, 'site feature')}`
            : 'nothing set to AI yet',
      ]
        .filter(Boolean)
        .join(' · ');

  const premadeSites = enabledPremade.reduce((sum, list) => sum + list.domainCount, 0);
  const premadeSummary = premadeListsLocked
    ? `${PREMADE_LISTS.length} categories, ${TOTAL_PREMADE_DOMAINS.toLocaleString()} sites`
    : enabledPremade.length === 0
      ? `None on · ${PREMADE_LISTS.length} categories, ${TOTAL_PREMADE_DOMAINS.toLocaleString()} sites`
      : `${enabledPremade.length} of ${PREMADE_LISTS.length} on · ${premadeSites.toLocaleString()} sites`;

  const pools = selected?.config.pools ?? [];
  const poolsSummary =
    pools.length === 0
      ? 'None · give yourself a few keyless unlocks a day'
      : pools.length === 1
        ? `${poolSummary(pools[0]!)} · covers ${plural(pools[0]!.items.length, 'item')}`
        : `${pools.length} pools`;

  const proBadge = <Badge tone="neutral">Pro</Badge>;

  return (
    <div className="flex min-h-full flex-col pt-3">
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
                {selected ? profileSummary(selected, aiMode) : '—'}
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
              <div className="absolute left-0 top-[calc(100%+7px)] z-50 w-[322px] animate-rise rounded-xl border border-white/[0.12] bg-[rgb(var(--color-panel)/0.97)] p-[7px] shadow-[0_18px_46px_rgb(var(--color-black)/0.6)] backdrop-blur-xl">
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
                          {profileSummary(p, aiMode)}
                        </span>
                      </span>
                      {isOn(p.id) ? (
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
                  {selected && selected.id !== defaultProfileId && (
                    <button
                      onClick={() => {
                        setMenuOpen(false);
                        void makeDefault(selected.id);
                      }}
                      className="flex items-center gap-2.5 rounded-[9px] px-2.5 py-2 text-left text-[12px] font-medium text-slate-400 transition hover:bg-white/[0.05] hover:text-slate-200"
                    >
                      <span className="font-mono text-[13px] text-slate-500">★</span>
                      Use {selected.name} for “Turn on focus”
                    </button>
                  )}
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

        {selected && (
          <div className="ml-auto flex items-center gap-2">
            <span className={cx('font-mono text-[10px] tracking-[0.12em]', isActive ? 'text-okInk' : 'text-slate-450')}>
              {isActive ? 'ON' : 'OFF'}
            </span>
            <ProfileSwitch
              label={`${selected.name} ${isActive ? 'on' : 'off'}`}
              on={isActive}
              disabled={!isActive && pairedKeys.length === 0}
              onChange={() => (isActive ? setOverridesOpen(true) : void turnOn(selected.id))}
            />
          </div>
        )}
      </div>

      {error && (
        <p className="mt-3 rounded-[9px] border border-danger/30 bg-danger/[0.08] px-3 py-2 text-[12px] text-dangerInk">
          {error}
        </p>
      )}

      <section className="mt-4 flex min-w-0 flex-col gap-2 pb-6">
        {aiMode && (
          <BlocklistSection
            title="AI filter"
            help={
              <>
                Tell it what you’re working on. Anything set to “AI” — sites on neither list, or a
                soft-blocked feature — gets checked against that, and pages that don’t fit are
                blocked.
              </>
            }
            active={Boolean(judge) && (unlisted === 'judge' || softJudged > 0)}
            summary={aiSummary}
            chips={judge?.tasks.map((task) => task.title)}
            badge={!smartAllowed ? proBadge : undefined}
            open={openSection === 'ai'}
            onToggle={() => toggleSection('ai')}
          >
            <JudgeSettings
              key={selected?.id}
              policy={policy}
              allowed={smartAllowed}
              onSave={(next) => void save(next)}
              onUpgrade={onUpgrade}
            />
          </BlocklistSection>
        )}

        <BlocklistSection
          title="Hard blocks"
          help={
            <>
              Blocked sites never load; allowed sites always do. The switch at the top decides what
              happens to every site on neither list.
            </>
          }
          active={unlisted !== 'allow' || policy.blockedDomains.length > 0}
          summary={hardSummary}
          chips={hardChips}
          open={openSection === 'hard'}
          onToggle={() => toggleSection('hard')}
        >
          <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
            <span className="text-[12.5px] text-slate-300">Sites on neither list are</span>
            <span role="radiogroup" className="flex overflow-hidden rounded-full border border-white/[0.10]">
              {(
                [
                  ['allow', 'Allowed'],
                  ['block', 'Blocked'],
                  ...(SMART_FILTERING_ENABLED && aiMode ? [['judge', 'Checked by AI']] : []),
                ] as ['allow' | 'block' | 'judge', string][]
              ).map(([action, label]) => {
                const on = unlisted === action;
                return (
                  <button
                    key={action}
                    role="radio"
                    aria-checked={on}
                    onClick={() => !on && void setUnlisted(action)}
                    className={cx(
                      'px-3 py-1 text-[11.5px] font-semibold transition',
                      on ? 'bg-white/[0.12] text-slate-100' : 'text-slate-450 hover:text-slate-200',
                    )}
                  >
                    {label}
                    {action === 'judge' && !smartAllowed && (
                      <span className="ml-1 font-mono text-[9px] tracking-[0.08em] text-slate-450">PRO</span>
                    )}
                  </button>
                );
              })}
            </span>

            <Button
              variant={blockingEverything ? 'ghost' : 'danger'}
              onClick={() => void blockEverything()}
              disabled={blockingEverything}
              className="ml-auto px-3.5 py-1.5 text-[11.5px]"
            >
              {blockingEverything
                ? 'Whole internet blocked'
                : confirmBlockAll
                  ? `Clear ${plural(policy.allowedDomains.length, 'allowed site')} and block everything?`
                  : 'Block everything'}
            </Button>
          </div>

          {blockingEverything && (
            <p className="mt-2.5 text-[11.5px] text-slate-400">
              Nothing loads while this profile is on. Add sites to “Always allow” to let them through.
            </p>
          )}

          <div className={cx('mt-4 grid gap-5', SMART_FILTERING_ENABLED && 'grid-cols-2')}>
            {(SMART_FILTERING_ENABLED || classicMode === 'blacklist') && (
              <DomainListEditor
                title={SMART_FILTERING_ENABLED ? 'Always block' : 'Block list'}
                hint="*.example.com covers subdomains"
                placeholder="reddit.com"
                accent={palette.colors.danger}
                domains={policy.blockedDomains}
                onAdd={addBlockedDomain}
                onAddMany={addManyBlockedDomains}
                onRemove={removeBlockedDomain}
                max={maxBlocked}
                limitReached={blockedLimitReached}
              />
            )}
            {(SMART_FILTERING_ENABLED || classicMode === 'whitelist') && (
              <DomainListEditor
                title={SMART_FILTERING_ENABLED ? 'Always allow' : 'Allow list'}
                hint={
                  !SMART_FILTERING_ENABLED
                    ? 'everything else is blocked'
                    : aiMode
                      ? 'never blocked, never judged'
                      : 'never blocked'
                }
                placeholder="mail.google.com"
                accent={palette.colors.success}
                domains={policy.allowedDomains}
                onAdd={addAllowedDomain}
                onAddMany={addManyAllowedDomains}
                onRemove={removeAllowedDomain}
                max={maxAllowed}
                limitReached={allowedLimitReached}
              />
            )}
          </div>
        </BlocklistSection>

        <BlocklistSection
          title="Soft blocks"
          help={
            <>
              Keep using a site — search, messages, a specific video — with its feeds and
              recommendations hidden.
            </>
          }
          active={softOn.length > 0}
          summary={softSummary}
          chips={softOn.map((site) => site.label)}
          open={openSection === 'soft'}
          onToggle={() => toggleSection('soft')}
        >
          <SiteRules
            key={selected?.id}
            policy={policy}
            supported={sitesSupported}
            aiMode={aiMode}
            smartAllowed={smartAllowed}
            limitReached={blockedLimitReached}
            onSave={(next) => void save(next)}
            onError={setError}
            onUpgrade={onUpgrade}
          />
        </BlocklistSection>

        <BlocklistSection
          title="Premade lists"
          active={enabledPremade.length > 0}
          summary={premadeSummary}
          chips={enabledPremade.map((list) => list.label)}
          badge={premadeListsLocked ? proBadge : undefined}
          open={openSection === 'premade'}
          onToggle={() => toggleSection('premade')}
        >
          <p className="text-[11.5px] leading-snug text-slate-450">
            {premadeListsLocked
              ? 'Categories with too many sites to list by hand. Premade lists are a Pro feature.'
              : 'Categories with too many sites to list by hand. They block alongside your own lists.'}
          </p>
          <div className="mt-3 grid grid-cols-2 gap-2">
            {PREMADE_LISTS.map((list) => {
              const enabled = !premadeListsLocked && policy.enabledPremadeLists.includes(list.id);
              return (
                <button
                  key={list.id}
                  role="switch"
                  aria-checked={enabled}
                  onClick={() => togglePremadeList(list.id)}
                  className={cx(
                    'flex items-center gap-3 rounded-[10px] border px-3 py-2.5 text-left transition',
                    premadeListsLocked
                      ? 'border-white/[0.07] bg-white/[0.015] opacity-60 hover:border-white/[0.14]'
                      : enabled
                        ? 'border-seal/30 bg-seal/[0.09]'
                        : 'border-white/[0.07] bg-white/[0.025] hover:border-white/[0.14] hover:bg-white/[0.05]',
                  )}
                >
                  <span className="min-w-0 flex-1">
                    <span className="text-[12.5px] font-semibold text-slate-250">{list.label}</span>
                    <span className="ml-2 font-mono text-[10.5px] text-slate-500">
                      {list.domainCount.toLocaleString()}
                    </span>
                    <span className="mt-0.5 block text-[11px] leading-snug text-slate-500">
                      {list.description}
                    </span>
                  </span>
                  <Switch on={enabled} />
                </button>
              );
            })}
          </div>
          {premadeListsLocked && (
            <Button onClick={onUpgrade} className="mt-3 px-4 py-1.5 text-[11.5px]">
              Upgrade to Pro
            </Button>
          )}
        </BlocklistSection>

        <BlocklistSection
          title="Blocked apps"
          active={policy.apps.length > 0}
          summary={
            appBlockingLocked
              ? 'Close distracting programs while focus is on'
              : policy.apps.length === 0
                ? 'None'
                : maxApps === null
                  ? plural(policy.apps.length, 'app')
                  : `${policy.apps.length}/${maxApps} apps`
          }
          chips={policy.apps.map((app) => app.label)}
          badge={appBlockingLocked ? proBadge : undefined}
          open={openSection === 'apps'}
          onToggle={() => toggleSection('apps')}
        >
          {appBlockingLocked ? (
            <div className="flex items-center gap-3">
              <p className="text-[12px] text-slate-400">App blocking is a Pro feature.</p>
              <Button onClick={onUpgrade} className="px-4 py-1.5 text-[11.5px]">
                Upgrade to Pro
              </Button>
            </div>
          ) : (
            <>
              <div className="flex gap-2">
                <Button onClick={openAppPicker} disabled={appLimitReached} className="shrink-0 px-4 py-1.5">
                  Choose apps
                </Button>
                <Input
                  value={appName}
                  onChange={(e) => setAppName(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && addApp()}
                  placeholder="Or type a program name: chrome.exe, steam"
                  disabled={appLimitReached}
                  className="py-1.5 font-mono"
                />
                <Button variant="ghost" onClick={addApp} disabled={appLimitReached} className="shrink-0 px-4 py-1.5">
                  Add
                </Button>
              </div>
              <div className="mt-3 flex flex-wrap gap-1.5">
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
                    These programs get closed whenever this profile is on.
                  </p>
                )}
              </div>
            </>
          )}
        </BlocklistSection>

        {selected && (
          <BlocklistSection
            title="Unlock pools"
            help={
              <>
                Keyless unlocks you allow yourself each day. Unlocking one item in a pool opens
                everything in it for the set time.
              </>
            }
            active={pools.length > 0}
            summary={poolsSummary}
            chips={pools.map((pool) => pool.name)}
            open={openSection === 'pools'}
            onToggle={() => toggleSection('pools')}
          >
            <PoolEditor pools={pools} policy={policy} onSave={(next) => void savePools(next)} />
          </BlocklistSection>
        )}
      </section>

      {pickerOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-[rgb(var(--color-background)/0.72)] px-4 backdrop-blur-md"
          role="dialog"
          aria-modal="true"
          aria-labelledby="app-picker-title"
        >
          <div className="flex max-h-[82vh] w-full max-w-2xl flex-col rounded-xl border border-white/[0.09] bg-[rgb(var(--color-panel)/0.96)] shadow-[0_24px_60px_-20px_rgb(var(--color-black)/0.9)]">
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
