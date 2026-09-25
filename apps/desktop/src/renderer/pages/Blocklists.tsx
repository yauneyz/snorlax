import React, { useMemo, useState } from 'react';
import type { AppRef, Policy, PremadeListId, Profile } from '@talysman/shared';
import { PREMADE_LISTS } from '@talysman/shared';
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
import { PoolEditor } from '../components/PoolEditor.js';
import { ProfileSwitch } from '../components/ProfileList.js';
import { desktopPaletteColor } from '../lib/desktopPalette.js';
import { useFocusStore } from '../store/useFocusStore.js';
import { Badge, Button, Input, Kicker, ProfileDot, Textarea } from '../components/ui/index.js';
import { cx, profileSummary } from '../lib/utils.js';
import { SiteRules } from '../components/SiteRules.js';
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

/**
 * One-click starting points over the generalized `{blockedDomains, allowedDomains,
 * defaultAction, judge}` shape (see `packages/shared/src/policy.ts`) — not enforced modes,
 * just prefills. "Smart" judges unlisted pages against your tasks; with no task yet it just
 * points at the AI filter section, since a judge needs something to judge against.
 */
type Preset = {
  value: 'blacklist' | 'whitelist' | 'block-all' | 'smart';
  label: string;
  hint: string;
};

const TOTAL_PREMADE_DOMAINS = PREMADE_LISTS.reduce((sum, list) => sum + list.domainCount, 0);

const SMART_FILTERING_ENABLED = productFeaturesForEnvironment(
  __APP_CONFIG__.APP_ENV,
).smartFiltering;

/** Page-level indicators follow the desktop app's signal color; profile colours stay in the switcher. */
const BLOCKLIST_SIGNAL = desktopPaletteColor('signal');

const CLASSIC_PRESETS: Preset[] = [
  { value: 'blacklist', label: 'Blacklist', hint: 'Block only the sites you list.' },
  { value: 'whitelist', label: 'Whitelist', hint: 'Block everything except your list.' },
];

const GENERAL_PRESETS: Preset[] = [
  { value: 'blacklist', label: 'Simple blocklist', hint: 'Block only the sites you list.' },
  { value: 'whitelist', label: 'Strict allowlist', hint: 'Block everything except your list.' },
  { value: 'block-all', label: 'Block everything', hint: 'No internet at all.' },
];

const SMART_PRESET: Preset = {
  value: 'smart',
  label: 'Smart',
  hint: 'AI judges anything else against what you’re working on.',
};

/** "Smart" only exists while AI mode is on; otherwise there's no hint AI filtering exists. */
function presetsFor(aiMode: boolean): Preset[] {
  if (!SMART_FILTERING_ENABLED) return CLASSIC_PRESETS;
  return aiMode ? [...GENERAL_PRESETS, SMART_PRESET] : GENERAL_PRESETS;
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

/** One row in a domain list — the sibling-hint UI is shared between the inline grid and the edit modal. */
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
    <div className="flex items-center gap-2.5 bg-panel px-3.5 py-2">
      <span
        className="block h-[5px] w-[5px] shrink-0 rounded-full"
        style={{ backgroundColor: accent }}
      />
      <span className="min-w-0 flex-1 truncate font-mono text-[12.5px] text-slate-200">{d}</span>
      {siblings.length > 0 && (
        <span
          className="hidden max-w-[40%] truncate text-[11px] text-slate-450 xl:block"
          title={siblings.join(', ')}
        >
          also {siblings.join(', ')}
        </span>
      )}
      <button
        onClick={() => onRemove(d)}
        className="shrink-0 text-[11px] font-medium text-slate-500 transition hover:text-dangerInk"
      >
        remove
      </button>
    </div>
  );
}

/**
 * The full-list editor opened from "Edit" — single column, a search box, and a paste-many box so
 * power users can manage a list of hundreds without hunting through a two-column grid or adding
 * one line at a time.
 */
function DomainListModal({
  kicker,
  accent,
  domains,
  onAdd,
  onAddMany,
  onRemove,
  max,
  limitReached,
  onClose,
}: {
  kicker: string;
  accent: string;
  domains: string[];
  onAdd: (d: string) => void;
  onAddMany: (domains: string[]) => void;
  onRemove: (d: string) => void;
  max: number | null;
  limitReached: boolean;
  onClose: () => void;
}) {
  const [query, setQuery] = useState('');
  const [pasteOpen, setPasteOpen] = useState(false);
  const [pasteText, setPasteText] = useState('');
  const [quickAdd, setQuickAdd] = useState('');

  function submitQuickAdd() {
    const trimmed = quickAdd.trim();
    if (!trimmed) return;
    onAdd(trimmed);
    setQuickAdd('');
  }

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return domains;
    return domains.filter((d) => d.toLowerCase().includes(q));
  }, [domains, query]);

  function submitPaste() {
    const parsed = pasteText
      .split(/[\n,]+/)
      .map((s) => s.trim())
      .filter(Boolean);
    if (parsed.length === 0) return;
    onAddMany(parsed);
    setPasteText('');
    setPasteOpen(false);
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-[rgb(var(--color-background)/0.72)] px-4 backdrop-blur-md"
      role="dialog"
      aria-modal="true"
      aria-labelledby="domain-list-modal-title"
      onKeyDown={(e) => e.key === 'Escape' && onClose()}
    >
      <div className="flex max-h-[82vh] w-full max-w-2xl flex-col rounded-xl border border-white/[0.09] bg-[rgb(var(--color-panel)/0.96)] shadow-[0_24px_60px_-20px_rgb(var(--color-black)/0.9)]">
        <div className="border-b border-white/[0.07] p-5">
          <div className="flex items-start justify-between gap-4">
            <div>
              <h2
                id="domain-list-modal-title"
                className="font-mono text-[10px] font-medium uppercase tracking-[0.2em] text-slate-500"
              >
                Edit {kicker.toLowerCase()}
              </h2>
              <p className="mt-2 text-[12.5px] text-slate-400">
                {max === null ? domains.length : `${domains.length}/${max}`} sites
              </p>
            </div>
            <button
              onClick={onClose}
              className="rounded-lg px-2 py-1 text-[12px] text-slate-400 hover:bg-white/[0.06] hover:text-white"
              aria-label="Close editor"
            >
              Close
            </button>
          </div>
          <div className="mt-4 flex gap-2">
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search this list"
              autoFocus
              className="font-mono"
            />
            <Button
              variant="ghost"
              onClick={() => setPasteOpen((v) => !v)}
              className="shrink-0 px-4"
            >
              {pasteOpen ? 'Cancel paste' : 'Paste many'}
            </Button>
          </div>

          <div className="mt-2.5 flex gap-2">
            <Input
              value={quickAdd}
              onChange={(e) => setQuickAdd(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && submitQuickAdd()}
              placeholder="Add a single site"
              disabled={limitReached}
              className="font-mono"
            />
            <Button onClick={submitQuickAdd} disabled={limitReached} className="shrink-0 px-5">
              Add
            </Button>
          </div>

          {pasteOpen && (
            <div className="mt-2.5">
              <Textarea
                rows={4}
                value={pasteText}
                onChange={(e) => setPasteText(e.target.value)}
                placeholder={'One per line, or comma-separated\nreddit.com\nyoutube.com'}
                disabled={limitReached}
                className="font-mono"
              />
              <div className="mt-2 flex justify-end">
                <Button onClick={submitPaste} disabled={limitReached || !pasteText.trim()}>
                  Add all
                </Button>
              </div>
            </div>
          )}
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto p-3">
          <div className="flex flex-col gap-px overflow-hidden rounded-[10px] border border-white/[0.06] bg-white/[0.05]">
            {filtered.map((d) => (
              <DomainRow key={d} d={d} accent={accent} onRemove={onRemove} />
            ))}
            {filtered.length === 0 && (
              <p className="bg-panel px-3.5 py-3 text-[12px] text-slate-500">
                {domains.length === 0 ? 'No sites yet.' : 'No matches.'}
              </p>
            )}
          </div>
        </div>

        <div className="flex justify-end gap-2 border-t border-white/[0.07] p-4">
          <Button onClick={onClose}>Done</Button>
        </div>
      </div>
    </div>
  );
}

/** One "Always block" / "Always allow" list — same add/remove/sibling-hint UI, different binding. */
function DomainListEditor({
  kicker,
  hint,
  placeholder,
  accent,
  domains,
  input,
  onInputChange,
  onAdd,
  onAddMany,
  onRemove,
  max,
  limitReached,
}: {
  kicker: string;
  hint: string;
  placeholder: string;
  accent: string;
  domains: string[];
  input: string;
  onInputChange: (v: string) => void;
  onAdd: () => void;
  onAddMany: (domains: string[]) => void;
  onRemove: (d: string) => void;
  max: number | null;
  limitReached: boolean;
}) {
  const [editOpen, setEditOpen] = useState(false);

  return (
    <>
      <div className="mt-4 flex items-baseline gap-2.5">
        <Kicker>{kicker}</Kicker>
        <span className="text-[11px] text-slate-600">
          {max === null ? domains.length : `${domains.length}/${max}`}
        </span>
        <button
          onClick={() => setEditOpen(true)}
          className="text-[11px] font-medium text-slate-450 transition hover:text-slate-200"
        >
          Edit
        </button>
        <span className="ml-auto text-[11px] text-slate-450">{hint}</span>
      </div>

      <div className="mt-2 flex gap-2">
        <Input
          value={input}
          onChange={(e) => onInputChange(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && onAdd()}
          placeholder={placeholder}
          disabled={limitReached}
          className="font-mono"
        />
        <Button onClick={onAdd} disabled={limitReached} className="shrink-0 px-5">
          Add
        </Button>
      </div>

      <div className="mt-2.5 max-h-[228px] overflow-y-auto rounded-[10px] border border-white/[0.06] bg-white/[0.05]">
        <div className="grid grid-cols-2 content-start gap-px">
          {domains.map((d) => (
            <DomainRow key={d} d={d} accent={accent} onRemove={onRemove} />
          ))}
          {domains.length === 0 && (
            <p className="col-span-2 bg-panel px-3.5 py-3 text-[12px] text-slate-500">
              No sites yet.
            </p>
          )}
        </div>
      </div>

      {editOpen && (
        <DomainListModal
          kicker={kicker}
          accent={accent}
          domains={domains}
          onAdd={(d) => {
            onInputChange(d);
            onAdd();
          }}
          onAddMany={onAddMany}
          onRemove={onRemove}
          max={max}
          limitReached={limitReached}
          onClose={() => setEditOpen(false)}
        />
      )}
    </>
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
  const [blockedInput, setBlockedInput] = useState('');
  const [allowedInput, setAllowedInput] = useState('');
  const [premadeOpen, setPremadeOpen] = useState(false);
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
  // Collapsed, the section is a summary: just what's on. The full catalog (with its toggles, and
  // the upgrade nudge for free users) lives behind "Browse categories".
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

  function applyPreset(preset: 'blacklist' | 'whitelist' | 'block-all' | 'smart') {
    if (preset === 'smart') {
      if (!smartAllowed) return onUpgrade();
      // Without a task the judge has nothing to judge against; the AI filter section asks for one.
      if (!policy.judge) return setError('Add what you’re working on to the AI filter first.');
      return save({ ...policy, defaultAction: 'judge' });
    }
    if (preset === 'blacklist') {
      return save({
        ...policy,
        blockedDomains: SMART_FILTERING_ENABLED ? policy.blockedDomains : classicDomains,
        allowedDomains: SMART_FILTERING_ENABLED ? policy.allowedDomains : [],
        defaultAction: 'allow',
      });
    }
    if (preset === 'whitelist') {
      return save({
        ...policy,
        blockedDomains: SMART_FILTERING_ENABLED ? policy.blockedDomains : [],
        allowedDomains: SMART_FILTERING_ENABLED ? policy.allowedDomains : classicDomains,
        defaultAction: 'block',
      });
    }
    return save({ ...policy, blockedDomains: [], allowedDomains: [], defaultAction: 'block' });
  }

  const addBlockedDomain = () => {
    if (!blockedInput.trim()) return;
    if (blockedLimitReached) {
      return setError(`Free supports up to ${maxBlocked} blocked websites.`);
    }
    void save({
      ...policy,
      blockedDomains: [...policy.blockedDomains, blockedInput.trim()],
      allowedDomains: SMART_FILTERING_ENABLED ? policy.allowedDomains : [],
    });
    setBlockedInput('');
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

  const addAllowedDomain = () => {
    if (!allowedInput.trim()) return;
    if (allowedLimitReached) {
      return setError(`Free supports up to ${maxAllowed} allowed websites.`);
    }
    void save({
      ...policy,
      blockedDomains: SMART_FILTERING_ENABLED ? policy.blockedDomains : [],
      allowedDomains: [...policy.allowedDomains, allowedInput.trim()],
    });
    setAllowedInput('');
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

      <section className="flex min-h-0 min-w-0 flex-1 flex-col">
        {aiMode && (
          <JudgeSettings
            key={selected?.id}
            policy={policy}
            allowed={smartAllowed}
            onSave={(next) => void save(next)}
            onUpgrade={onUpgrade}
          />
        )}

        {/* One-click starting points — each just prefills the fields below. */}
        <div className="mt-3 flex gap-2">
          {presetsFor(aiMode).map((p) => {
            const locked = p.value === 'smart' && !smartAllowed;
            const active = SMART_FILTERING_ENABLED
              ? p.value === 'smart' && policy.defaultAction === 'judge'
              : (p.value === 'blacklist' || p.value === 'whitelist') && p.value === classicMode;
            return (
              <button
                key={p.value}
                onClick={() => applyPreset(p.value)}
                aria-disabled={locked}
                className={cx(
                  'flex-1 rounded-[10px] border px-3 py-2.5 text-left transition',
                  active
                    ? 'border-seal/30 bg-seal/[0.09] shadow-[inset_0_1px_0_rgb(var(--color-white)/0.06),0_0_18px_rgb(var(--color-signal)/0.10)]'
                    : 'border-white/[0.07] bg-white/[0.025] hover:border-white/[0.14] hover:bg-white/[0.05]',
                  locked && 'opacity-65',
                )}
              >
                <span className="flex items-center gap-2">
                  <span className="text-[12.5px] font-semibold text-slate-250">{p.label}</span>
                  {locked && <Badge tone="neutral">Pro</Badge>}
                </span>
                <span className="mt-1 block text-[11px] leading-snug text-slate-400">{p.hint}</span>
              </button>
            );
          })}
        </div>

        {(SMART_FILTERING_ENABLED || classicMode === 'blacklist') && (
          <DomainListEditor
            kicker={SMART_FILTERING_ENABLED ? 'Always block' : 'Block list'}
            hint="wildcards allowed as a leading “*.”"
            placeholder="reddit.com"
            accent={accent}
            domains={policy.blockedDomains}
            input={blockedInput}
            onInputChange={setBlockedInput}
            onAdd={addBlockedDomain}
            onAddMany={addManyBlockedDomains}
            onRemove={removeBlockedDomain}
            max={maxBlocked}
            limitReached={blockedLimitReached}
          />
        )}

        {(SMART_FILTERING_ENABLED || classicMode === 'whitelist') && (
          <DomainListEditor
            kicker={SMART_FILTERING_ENABLED ? 'Always allow' : 'Allow list'}
            hint={
              !SMART_FILTERING_ENABLED
                ? 'everything else is blocked'
                : aiMode
                  ? 'never blocked, never judged'
                  : 'never blocked'
            }
            placeholder="mail.google.com"
            accent={accent}
            domains={policy.allowedDomains}
            input={allowedInput}
            onInputChange={setAllowedInput}
            onAdd={addAllowedDomain}
            onAddMany={addManyAllowedDomains}
            onRemove={removeAllowedDomain}
            max={maxAllowed}
            limitReached={allowedLimitReached}
          />
        )}

        <SiteRules
          policy={policy}
          supported={sitesSupported}
          aiMode={aiMode}
          smartAllowed={smartAllowed}
          limitReached={blockedLimitReached}
          onSave={(next) => void save(next)}
          onError={setError}
          onUpgrade={onUpgrade}
        />

        <div className="mt-4">
          {/* While the categories are open the header pins to the top of the page scroller, so
              "Done" stays reachable no matter how far down the list you are. */}
          <div
            className={cx(
              premadeOpen && 'sticky top-0 z-10 bg-[rgb(var(--color-background))] pb-2',
            )}
          >
            <div className="flex items-baseline gap-2.5">
              <Kicker>Premade blocklists</Kicker>
              <span className="text-[11px] text-slate-600">
                {enabledPremade.length}/{PREMADE_LISTS.length} on
              </span>
            </div>
            <Button
              variant="ghost"
              onClick={() => setPremadeOpen((v) => !v)}
              aria-expanded={premadeOpen}
              aria-controls="premade-lists"
              className="mt-2 px-3 py-1 text-[11px]"
            >
              {premadeOpen ? 'Done' : 'Browse categories →'}
            </Button>
          </div>

          {!premadeOpen && (
            <div className="mt-2 flex flex-wrap items-center gap-1.5">
              {enabledPremade.length === 0 ? (
                <p className="text-[11px] leading-snug text-slate-500">
                  None on — {PREMADE_LISTS.length} built-in categories available, covering{' '}
                  {TOTAL_PREMADE_DOMAINS.toLocaleString()} sites.
                </p>
              ) : (
                enabledPremade.map((list) => (
                  <span
                    key={list.id}
                    className="rounded-full border border-seal/30 bg-seal/[0.09] px-2.5 py-1 text-[11px] text-slate-250"
                  >
                    {list.label}
                    <span className="ml-1.5 text-slate-500">
                      {list.domainCount.toLocaleString()}
                    </span>
                  </span>
                ))
              )}
            </div>
          )}

          {premadeOpen && (
            <div id="premade-lists" className="mt-2.5 max-h-[300px] overflow-y-auto pr-0.5">
              <p className="text-[11px] leading-snug text-slate-500">
                {premadeListsLocked
                  ? 'Built-in categories with too many sites to list by hand — a Pro feature.'
                  : 'Built-in categories with too many sites to list by hand. Toggle any on alongside your own block list — turning one on is free, turning one off needs your key while focus is enforcing.'}
              </p>
              <div className="mt-2.5 flex flex-col gap-1.5">
                {PREMADE_LISTS.map((list) => {
                  const enabled =
                    !premadeListsLocked && policy.enabledPremadeLists.includes(list.id);
                  return (
                    <button
                      key={list.id}
                      onClick={() => togglePremadeList(list.id)}
                      className={cx(
                        'flex items-center gap-3 rounded-[10px] border px-3 py-2.5 text-left transition',
                        premadeListsLocked
                          ? 'border-white/[0.07] bg-white/[0.015] opacity-60 hover:border-white/[0.14]'
                          : enabled
                            ? 'border-seal/30 bg-seal/[0.09] shadow-[inset_0_1px_0_rgb(var(--color-white)/0.06),0_0_18px_rgb(var(--color-signal)/0.10)]'
                            : 'border-white/[0.07] bg-white/[0.025] hover:border-white/[0.14] hover:bg-white/[0.05]',
                      )}
                    >
                      <span className="flex-1">
                        <span className="text-[12.5px] font-semibold text-slate-250">
                          {list.label}
                        </span>
                        <span className="ml-2 text-[11px] text-slate-500">
                          {list.domainCount.toLocaleString()} sites
                        </span>
                        <span className="mt-0.5 block text-[11px] leading-snug text-slate-500">
                          {list.description}
                        </span>
                      </span>
                      <span
                        role="switch"
                        aria-checked={enabled}
                        className={cx(
                          'relative h-5 w-9 shrink-0 rounded-full transition',
                          enabled ? 'bg-seal/70' : 'bg-white/10',
                        )}
                      >
                        <span
                          className={cx(
                            'absolute top-0.5 h-4 w-4 rounded-full bg-white transition',
                            enabled ? 'left-[18px]' : 'left-0.5',
                          )}
                        />
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>
          )}
        </div>

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

        <div className="mt-2.5 flex max-h-[150px] flex-wrap gap-1.5 overflow-y-auto">
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

        {selected && (
          <PoolEditor pools={selected.config.pools} policy={policy} onSave={(pools) => void savePools(pools)} />
        )}

        {error && <p className="mt-3 text-[12.5px] text-dangerInk">{error}</p>}
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
