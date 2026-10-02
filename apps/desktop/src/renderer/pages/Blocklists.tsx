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
import { normalizeDomain, siblingsFor } from '@talysman/core/browser';
import { prepareDomainPaste } from '../lib/domainPaste.js';
import { listInstalledApps } from '../lib/bridge.js';
import { runCommand, saveProfile as saveProfileCommand } from '../lib/engine.js';
import { PoolEditor, poolSummary } from '../components/PoolEditor.js';
import { BlocklistSection } from '../components/BlocklistSection.js';
import { ProfileSwitch } from '../components/ProfileList.js';
import { desktopPaletteColor } from '../lib/desktopPalette.js';
import { useFocusStore } from '../store/useFocusStore.js';
import {
  Badge,
  Button,
  Input,
  Kicker,
  ProfileDot,
  Switch,
  StatusLabel,
  Textarea,
} from '../components/ui/index.js';
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

type FeedbackTarget = SectionId | 'profile' | 'blocked' | 'allowed' | 'picker';
type Feedback = { message: string; error: boolean };

function InlineFeedback({ feedback }: { feedback?: Feedback }) {
  if (!feedback) return null;
  return (
    <p
      role={feedback.error ? 'alert' : 'status'}
      className={cx(
        'mt-2 text-caption leading-relaxed',
        feedback.error ? 'text-dangerInk' : 'text-slate-300',
      )}
    >
      {feedback.message}
    </p>
  );
}

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

/** Compact removable entry shared by website and app lists. */
function EntryChip({
  label,
  detail,
  mono = false,
  onRemove,
}: {
  label: string;
  detail?: string;
  mono?: boolean;
  onRemove: () => void;
}) {
  return (
    <span
      title={detail || undefined}
      className="inline-flex max-w-full items-center gap-1.5 rounded-full border border-white/[0.08] bg-white/[0.03] py-1 pl-2.5 pr-1 text-caption text-slate-200"
    >
      <span className={cx('min-w-0 break-all', mono && 'font-mono')}>{label}</span>
      {detail && <span className="sr-only">{detail}</span>}
      <button
        type="button"
        onClick={onRemove}
        aria-label={`Remove ${label}`}
        className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-body leading-none text-slate-500 transition hover:bg-white/[0.06] hover:text-dangerInk"
      >
        ×
      </button>
    </span>
  );
}

/** A website chip, with covered sibling hosts available on hover. */
function DomainChip({ d, onRemove }: { d: string; onRemove: (d: string) => void }) {
  const siblings = siblingsFor(d);
  return (
    <EntryChip
      label={d}
      detail={siblings.length > 0 ? `Also covers ${siblings.join(', ')}` : undefined}
      mono
      onRemove={() => onRemove(d)}
    />
  );
}

/** Inline "upgrade to Pro" inside a free-limit message; opens the Plans page. */
function UpgradeLink({ onUpgrade }: { onUpgrade: () => void }) {
  return (
    <button
      type="button"
      onClick={onUpgrade}
      className="font-medium text-slate-100 underline underline-offset-2 transition hover:text-sealInk"
    >
      upgrade to Pro
    </button>
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
  domains,
  onAdd,
  onAddMany,
  onRemove,
  max,
  limitReached,
  onUpgrade,
  feedback,
}: {
  title: string;
  hint: string;
  placeholder: string;
  domains: string[];
  onAdd: (d: string) => Promise<boolean>;
  onAddMany: (domains: string[]) => Promise<boolean>;
  onRemove: (d: string) => void;
  max: number | null;
  limitReached: boolean;
  onUpgrade: () => void;
  feedback?: Feedback;
}) {
  const [input, setInput] = useState('');
  const [query, setQuery] = useState('');
  const [pasteOpen, setPasteOpen] = useState(false);
  const [pasteText, setPasteText] = useState('');
  const [pending, setPending] = useState(false);
  const limitId = React.useId();
  const searchable = domains.length > 8;

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return domains;
    return domains.filter((d) => d.toLowerCase().includes(q));
  }, [domains, query]);

  async function submit() {
    const trimmed = input.trim();
    if (!trimmed || pending || limitReached) return;
    setPending(true);
    try {
      if (await onAdd(trimmed)) setInput('');
    } finally {
      setPending(false);
    }
  }

  async function submitPaste() {
    const parsed = pasteText
      .split(/[\n,\s]+/)
      .map((s) => s.trim())
      .filter(Boolean);
    if (parsed.length === 0 || pending || limitReached) return;
    setPending(true);
    try {
      if (await onAddMany(parsed)) {
        setPasteText('');
        setPasteOpen(false);
      }
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="min-w-0">
      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
        <span className="text-body font-semibold text-slate-200">{title}</span>
        <span className="font-mono text-caption text-slate-500">
          {max === null ? domains.length : `${domains.length}/${max}`}
        </span>
        <span className="basis-full text-caption leading-relaxed text-slate-500">{hint}</span>
      </div>

      <div className="mt-2 flex gap-2">
        <Input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && submit()}
          aria-describedby={limitReached ? limitId : undefined}
          placeholder={placeholder}
          disabled={limitReached || pending}
          className="py-1.5 font-mono"
        />
        <Button
          onClick={submit}
          disabled={limitReached || pending}
          className="shrink-0 px-4 py-1.5"
        >
          Add
        </Button>
      </div>

      {limitReached && (
        <p id={limitId} className="mt-2 text-caption text-slate-400">
          Free limit reached ({max} websites). Remove an entry or{' '}
          <UpgradeLink onUpgrade={onUpgrade} /> to add more.
        </p>
      )}
      <InlineFeedback feedback={feedback} />

      {pasteOpen && (
        <div className="mt-2">
          <Textarea
            rows={4}
            value={pasteText}
            onChange={(e) => setPasteText(e.target.value)}
            placeholder={'One per line, or comma-separated\nreddit.com\nyoutube.com'}
            disabled={limitReached || pending}
            autoFocus
            className="font-mono"
          />
          <div className="mt-1.5 flex justify-end gap-2">
            <Button
              variant="ghost"
              onClick={() => setPasteOpen(false)}
              className="px-3 py-1 text-caption"
            >
              Cancel
            </Button>
            <Button
              onClick={submitPaste}
              disabled={limitReached || pending || !pasteText.trim()}
              className="px-3 py-1 text-caption"
            >
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
            className="py-1 text-caption"
          />
        )}
        {!pasteOpen && (
          <button
            onClick={() => setPasteOpen(true)}
            disabled={limitReached || pending}
            className="shrink-0 text-caption font-medium text-slate-450 transition hover:text-slate-200 disabled:opacity-45"
          >
            Paste many
          </button>
        )}
      </div>

      <div className="mt-3 flex max-h-[280px] flex-wrap items-start gap-1.5 overflow-y-auto">
        {filtered.map((d) => (
          <DomainChip key={d} d={d} onRemove={onRemove} />
        ))}
        {filtered.length === 0 && (
          <p className="py-1 text-caption text-slate-500">
            {domains.length === 0 ? 'No sites yet.' : 'No matches.'}
          </p>
        )}
      </div>
    </div>
  );
}

export function Blocklists({ onUpgrade }: { onUpgrade: () => void }) {
  const profiles = useFocusStore((s) => s.profiles);
  const engine = useFocusStore((s) => s.engine);
  const defaultProfileId = useFocusStore((s) => s.defaultProfileId);
  const pairedKeys = useFocusStore((s) => s.pairedKeys);
  const keyPresent = useFocusStore((s) => s.keyPresent);
  const productLimits = useFocusStore((s) => s.productLimits);
  const aiMode = useFocusStore((s) => s.aiMode);
  // Which profile the editor is pointed at. `null` shows the default profile.
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [openSection, setOpenSection] = useState<SectionId | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  // "Block everything" empties the allow list, so with sites on it the button asks once first.
  const [confirmBlockAll, setConfirmBlockAll] = useState(false);
  const [appName, setAppName] = useState('');
  const [pickerOpen, setPickerOpen] = useState(false);
  const [pickerLoading, setPickerLoading] = useState(false);
  const [pickerError, setPickerError] = useState<string | null>(null);
  const [pickerItems, setPickerItems] = useState<AppPickerItem[]>([]);
  const [pickerQuery, setPickerQuery] = useState('');
  const [selectedApps, setSelectedApps] = useState<Set<string>>(() => new Set());
  const [feedbackByProfile, setFeedbackByProfile] = useState<
    Record<string, Partial<Record<FeedbackTarget, Feedback>>>
  >({});

  const selected =
    profiles.find((p) => p.id === selectedId) ??
    profiles.find((p) => p.id === defaultProfileId) ??
    profiles[0];
  const policy = selected?.config.policy ?? EMPTY_POLICY;
  const sitesSupported = true;
  const isOn = (id: string | undefined) =>
    engine.profiles.some(
      (p) => p.profile.id === id && (p.activation.active || p.activation.paused),
    );
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

  const feedback = feedbackByProfile[selected?.id ?? 'new'] ?? {};
  function setFeedback(
    target: FeedbackTarget,
    message: string | null,
    error = true,
    profileId = selected?.id ?? 'new',
  ) {
    setFeedbackByProfile((current) => ({
      ...current,
      [profileId]: { ...current[profileId], [target]: message ? { message, error } : undefined },
    }));
  }

  /** Every edit on this page writes one whole profile; the service gates any loosening. */
  async function saveProfile(next: Profile, target: FeedbackTarget = 'profile'): Promise<boolean> {
    const feedbackProfileId = selected?.id ?? 'new';
    setFeedback(target, null, true, feedbackProfileId);
    try {
      await saveProfileCommand(next);
      return true;
    } catch (e) {
      setFeedback(target, (e as Error).message, true, feedbackProfileId);
      return false;
    }
  }

  async function save(next: Policy, target: FeedbackTarget = 'hard'): Promise<boolean> {
    if (!selected) return false;
    return saveProfile({ ...selected, config: { ...selected.config, policy: next } }, target);
  }

  async function savePools(pools: Profile['config']['pools']) {
    if (!selected) return;
    await saveProfile({ ...selected, config: { ...selected.config, pools } }, 'pools');
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
      await runCommand({
        type: 'duplicateProfile',
        profileId: selected.id,
        newId,
        color: nextProfileColor(profiles),
      });
      setSelectedId(newId);
    });
  }

  async function renameProfile(name: string) {
    const trimmed = name.trim().slice(0, MAX_PROFILE_NAME_LENGTH);
    if (!selected || !trimmed || trimmed === selected.name) return;
    await saveProfile({ ...selected, name: trimmed });
  }

  async function runProfileRequest(run: () => Promise<unknown>) {
    const feedbackProfileId = selected?.id ?? 'new';
    setFeedback('profile', null, true, feedbackProfileId);
    try {
      await run();
    } catch (e) {
      setFeedback('profile', (e as Error).message, true, feedbackProfileId);
    }
  }

  const deleteProfile = (profileId: string) =>
    runProfileRequest(async () => {
      await runCommand({ type: 'deleteProfile', profileId });
      if (selectedId === profileId) setSelectedId(null);
    });

  const turnOn = (profileId: string) =>
    runProfileRequest(() => runCommand({ type: 'setLatch', profileId, on: true }));
  // Turning one profile off is a key-gated override scoped to that profile.
  const turnOff = (profileId: string) =>
    runProfileRequest(() =>
      runCommand({ type: 'startOverrideExempt', profiles: [profileId], items: [] }),
    );

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
      if (!policy.judge?.tasks.length) {
        setOpenSection('ai');
        return setFeedback('ai', 'Add what you’re working on to the AI filter first.');
      }
      return save({ ...policy, defaultAction: 'judge' }, 'ai');
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
  function blockEverything(confirmed = false) {
    if (policy.allowedDomains.length > 0 && !confirmed) return setConfirmBlockAll(true);
    setConfirmBlockAll(false);
    return save({
      ...policy,
      blockedDomains: SMART_FILTERING_ENABLED ? policy.blockedDomains : [],
      allowedDomains: [],
      defaultAction: 'block',
    });
  }

  async function addDomain(domain: string, target: 'blocked' | 'allowed') {
    const blocked = target === 'blocked';
    const domains = blocked ? policy.blockedDomains : policy.allowedDomains;
    const max = blocked ? maxBlocked : maxAllowed;
    if (blocked ? blockedLimitReached : allowedLimitReached) {
      setFeedback(target, `Free supports up to ${max} ${target} websites.`);
      return false;
    }
    const normalized = normalizeDomain(domain);
    if ('error' in normalized) {
      setFeedback(target, `Cannot add “${domain}”: ${normalized.error}.`);
      return false;
    }
    if (domains.includes(normalized.domain)) {
      setFeedback(target, 'Already listed.', false);
      return true;
    }
    return saveDomainList([...domains, normalized.domain], target);
  }

  function saveDomainList(domains: string[], target: 'blocked' | 'allowed') {
    return save(
      {
        ...policy,
        blockedDomains:
          target === 'blocked' ? domains : SMART_FILTERING_ENABLED ? policy.blockedDomains : [],
        allowedDomains:
          target === 'allowed' ? domains : SMART_FILTERING_ENABLED ? policy.allowedDomains : [],
      },
      target,
    );
  }

  async function addManyDomains(raw: string[], target: 'blocked' | 'allowed') {
    const blocked = target === 'blocked';
    const domains = blocked ? policy.blockedDomains : policy.allowedDomains;
    const max = blocked ? maxBlocked : maxAllowed;
    const count = blocked ? blockedEntryCount : domains.length;
    const room = max === null ? Infinity : Math.max(0, max - count);
    const { additions, duplicates, overLimit, invalid } = prepareDomainPaste(raw, domains, room);
    setFeedback(target, null);
    if (additions.length > 0 && !(await saveDomainList([...domains, ...additions], target)))
      return false;
    setFeedback(
      target,
      [
        `Added ${additions.length}`,
        duplicates > 0 && `${duplicates} already listed or repeated`,
        overLimit > 0 && `${overLimit} over the Free limit`,
        invalid > 0 && `${invalid} invalid`,
      ]
        .filter(Boolean)
        .join(' · '),
      false,
    );
    return true;
  }

  const addBlockedDomain = (domain: string) => addDomain(domain, 'blocked');
  const addAllowedDomain = (domain: string) => addDomain(domain, 'allowed');
  const removeBlockedDomain = (domain: string) =>
    saveDomainList(
      policy.blockedDomains.filter((d) => d !== domain),
      'blocked',
    );
  const removeAllowedDomain = (domain: string) =>
    saveDomainList(
      policy.allowedDomains.filter((d) => d !== domain),
      'allowed',
    );
  const addManyBlockedDomains = (raw: string[]) => addManyDomains(raw, 'blocked');
  const addManyAllowedDomains = (raw: string[]) => addManyDomains(raw, 'allowed');

  const togglePremadeList = (id: PremadeListId) => {
    if (premadeListsLocked) return onUpgrade();
    const enabled = policy.enabledPremadeLists.includes(id);
    void save(
      {
        ...policy,
        enabledPremadeLists: enabled
          ? policy.enabledPremadeLists.filter((x) => x !== id)
          : [...policy.enabledPremadeLists, id],
      },
      'premade',
    );
  };

  const addApp = async () => {
    if (!appName.trim()) return;
    if (maxApps !== null && policy.apps.length >= maxApps) {
      return setFeedback('apps', `Free supports up to ${maxApps} blocked apps.`);
    }
    const name = appName.trim();
    if (
      await save(
        {
          ...policy,
          apps: [...policy.apps, { windowsImageName: name, linuxProcessName: name, label: name }],
        },
        'apps',
      )
    )
      setAppName('');
  };
  const removeApp = (target: AppRef) =>
    save({ ...policy, apps: policy.apps.filter((a) => appKey(a) !== appKey(target)) }, 'apps');

  async function openAppPicker() {
    setPickerOpen(true);
    setPickerQuery('');
    setSelectedApps(new Set());
    setPickerError(null);
    setFeedback('picker', null);
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
    if (!(await save({ ...policy, apps: [...policy.apps, ...picked] }, 'picker'))) return;
    setPickerOpen(false);
    setSelectedApps(new Set());
  }

  // ── Collapsed-row summaries ──────────────────────────────────────────────────────────────
  const unlisted = effectiveAction(policy.defaultAction, policy, aiMode);
  const blockingEverything = unlisted === 'block' && policy.allowedDomains.length === 0;
  const hardModeLabel = {
    allow: 'Block these sites',
    block: 'Allow only these sites',
    judge: 'Everything else checked by AI',
  }[unlisted];
  const hardSummary = SMART_FILTERING_ENABLED
    ? blockingEverything
      ? 'Blocking the whole internet'
      : `${hardModeLabel} · ${unlisted === 'block' ? policy.allowedDomains.length + ' allowed' : policy.blockedDomains.length + ' blocked'}`
    : classicMode === 'blacklist'
      ? `Blocking ${plural(classicDomains.length, 'site')}`
      : blockingEverything
        ? 'Blocking the whole internet'
        : `Allowing only ${plural(classicDomains.length, 'site')}`;
  const hardChips = unlisted === 'block' ? policy.allowedDomains : policy.blockedDomains;

  const listedSites = useListedSites(policy);
  const softOn = listedSites.filter((site) => policy.sites?.[site.id]);
  const softCounts = softOn.map((site) => siteRuleCounts(site, policy, aiMode));
  const softHidden = softCounts.reduce((sum, c) => sum + c.hidden, 0);
  const softJudged = softCounts.reduce((sum, c) => sum + c.judged, 0);
  const softSummary = policy.universalSoftBlock
    ? `Universal ${aiMode ? 'on' : 'paused · AI mode off'}${softOn.length ? ` · ${softOn.length} site rules` : ''}`
    : softOn.length === 0
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
      ? 'None · allow yourself a couple short breaks per day'
      : pools.length === 1
        ? `${poolSummary(pools[0]!)} · covers ${plural(pools[0]!.items.length, 'item')}`
        : `${pools.length} groups`;

  const proBadge = <Badge tone="neutral">Pro</Badge>;

  return (
    <div className="flex min-h-full flex-col pt-3">
      <div className="flex items-center gap-3">
        {/* The profile is the page's subject, so it doubles as the heading and the switcher. */}
        <div className="relative">
          <button
            onClick={() => {
              setMenuOpen((v) => !v);
              setConfirmDelete(false);
            }}
            aria-label="Choose profile"
            aria-expanded={menuOpen}
            className={cx(
              'flex items-center gap-3 rounded-[11px] border py-2 pl-3 pr-3.5 transition',
              menuOpen
                ? 'border-white/[0.18] bg-white/[0.07]'
                : 'border-white/[0.09] bg-white/[0.03] hover:border-white/[0.14] hover:bg-white/[0.05]',
            )}
          >
            <ProfileDot color={selected?.color ?? accent} size={10} glow />
            <span className="max-w-[190px] truncate text-heading font-bold leading-none text-slate-100">
              {selected?.name ?? 'No profile'}
            </span>
            <span
              className={cx(
                'ml-0.5 text-caption text-slate-400 transition-transform',
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
                <div className="px-2 pb-[7px] pt-1.5 font-mono text-caption font-medium tracking-[0.18em] text-slate-450">
                  SWITCH PROFILE ·{' '}
                  {profileLimit === null ? profiles.length : `${profiles.length}/${profileLimit}`}
                </div>

                <div className="flex max-h-56 flex-col gap-0.5 overflow-y-auto">
                  {profiles.map((p) => (
                    <button
                      key={p.id}
                      onClick={() => {
                        setSelectedId(p.id);
                        setConfirmDelete(false);
                        setConfirmBlockAll(false);
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
                            'block truncate text-body font-semibold',
                            p.id === selected?.id ? 'text-slate-100' : 'text-slate-250',
                          )}
                        >
                          {p.name}
                        </span>
                        <span className="mt-0.5 block break-words font-mono text-caption text-slate-450">
                          {profileSummary(p, aiMode)}
                        </span>
                      </span>
                      {isOn(p.id) ? (
                        <Badge tone="ok">ON</Badge>
                      ) : (
                        p.id === selected?.id && (
                          <span className="text-caption text-slate-400">editing</span>
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
                    className="flex items-center gap-2.5 rounded-[9px] px-2.5 py-2 text-left text-caption font-medium text-slate-200 transition hover:bg-white/[0.05]"
                  >
                    <span className="font-mono text-body text-slate-500">+</span>
                    {profileLimitReached ? 'Upgrade for more profiles' : 'New profile'}
                  </button>
                  <button
                    onClick={() => {
                      setMenuOpen(false);
                      void duplicateProfile();
                    }}
                    disabled={!selected}
                    className="flex items-center gap-2.5 rounded-[9px] px-2.5 py-2 text-left text-caption font-medium text-slate-400 transition hover:bg-white/[0.05] hover:text-slate-200 disabled:opacity-45"
                  >
                    <span className="font-mono text-body text-slate-500">⧉</span>
                    Duplicate {selected?.name}
                  </button>
                  {selected && selected.id !== defaultProfileId && (
                    <button
                      onClick={() => {
                        setMenuOpen(false);
                        void makeDefault(selected.id);
                      }}
                      className="flex items-center gap-2.5 rounded-[9px] px-2.5 py-2 text-left text-caption font-medium text-slate-400 transition hover:bg-white/[0.05] hover:text-slate-200"
                    >
                      <span className="font-mono text-body text-slate-500">★</span>
                      Make default
                    </button>
                  )}
                </div>

                <div className="mt-1.5 border-t border-white/[0.07] px-1.5 pb-1 pt-2">
                  <div className="flex items-baseline justify-between">
                    <Kicker className="text-caption tracking-[0.18em]">Rename</Kicker>
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
                  {profiles.length > 1 && selected && (
                    <div className="mt-3 border-t border-white/[0.07] pt-2">
                      {confirmDelete ? (
                        <>
                          <p className="text-caption text-slate-300">
                            Delete “{selected.name}” and its rules?
                          </p>
                          <div className="mt-2 flex gap-2">
                            <Button
                              variant="ghost"
                              onClick={() => setConfirmDelete(false)}
                              className="px-3 py-1.5"
                            >
                              Cancel
                            </Button>
                            <Button
                              variant="danger"
                              onClick={() => {
                                setMenuOpen(false);
                                setConfirmDelete(false);
                                void deleteProfile(selected.id);
                              }}
                              className="px-3 py-1.5"
                            >
                              Delete profile
                            </Button>
                          </div>
                        </>
                      ) : (
                        <button
                          onClick={() => setConfirmDelete(true)}
                          className="text-caption font-medium text-dangerInk"
                        >
                          Delete profile…
                        </button>
                      )}
                    </div>
                  )}
                  <InlineFeedback feedback={feedback.profile} />
                  {/* Only worth saying while the key is out — with it in, nothing here is gated. */}
                  {!keyPresent && (
                    <p className="mt-2 text-caption leading-relaxed text-slate-450">
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
            <StatusLabel on={isActive} tone="success" />
            <ProfileSwitch
              label={`${selected.name} ${isActive ? 'on' : 'off'}`}
              on={isActive}
              disabled={!isActive && pairedKeys.length === 0}
              onChange={() => void (isActive ? turnOff(selected.id) : turnOn(selected.id))}
            />
          </div>
        )}
      </div>

      {!menuOpen && <InlineFeedback feedback={feedback.profile} />}

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
            <label className="mb-3 flex items-center gap-2 text-caption text-slate-300">
              <input
                type="checkbox"
                checked={unlisted === 'judge'}
                onChange={() => {
                  if (unlisted === 'judge') void save({ ...policy, defaultAction: 'allow' }, 'ai');
                  else void setUnlisted('judge');
                }}
              />
              Check unlisted sites with AI
            </label>
            <InlineFeedback feedback={feedback.ai} />
            <JudgeSettings
              key={selected?.id}
              policy={policy}
              allowed={smartAllowed}
              onSave={(next) => void save(next, 'ai')}
              onUpgrade={onUpgrade}
            />
            <div className="mt-5">
              <DomainListEditor
                key={selected?.id}
                title="Always allow"
                hint="never blocked, never judged by AI"
                placeholder="mail.google.com"
                domains={policy.allowedDomains}
                onAdd={addAllowedDomain}
                onAddMany={addManyAllowedDomains}
                onRemove={removeAllowedDomain}
                max={maxAllowed}
                feedback={feedback.allowed}
                limitReached={allowedLimitReached}
                onUpgrade={onUpgrade}
              />
            </div>
          </BlocklistSection>
        )}

        <BlocklistSection
          title="Hard blocks"
          help={
            <>
              Choose whether to block listed sites, allow only listed sites, or block the whole
              internet. These rules apply while this profile is on.
            </>
          }
          active={unlisted !== 'allow' || policy.blockedDomains.length > 0}
          summary={hardSummary}
          chips={hardChips}
          open={openSection === 'hard'}
          onToggle={() => toggleSection('hard')}
        >
          <div role="radiogroup" aria-label="Hard block mode" className="flex flex-wrap gap-2">
            {(
              [
                ['allow', 'Block these sites'],
                ['block', 'Allow only these sites'],
                ['internet', 'Block the internet'],
              ] as const
            ).map(([mode, label]) => {
              const on =
                mode === 'internet'
                  ? blockingEverything
                  : mode === 'block'
                    ? unlisted === 'block' && !blockingEverything
                    : unlisted !== 'block';
              return (
                <button
                  key={mode}
                  role="radio"
                  aria-checked={on}
                  onClick={() => {
                    if (on && !(mode === 'allow' && unlisted === 'judge')) return;
                    setConfirmBlockAll(false);
                    if (mode === 'internet') void blockEverything();
                    else void setUnlisted(mode);
                  }}
                  className={cx(
                    'rounded-lg border px-3 py-2 text-caption font-medium transition',
                    on
                      ? 'border-white/20 bg-white/[0.12] text-slate-100'
                      : 'border-white/[0.10] text-slate-400 hover:text-slate-200',
                  )}
                >
                  {label}
                </button>
              );
            })}
          </div>
          <p className="mt-2 text-caption text-slate-400">
            {blockingEverything
              ? 'Nothing loads while this profile is on. Add allowed sites to let them through.'
              : unlisted === 'block'
                ? 'Only sites on the allow list can load.'
                : unlisted === 'judge'
                  ? 'Listed sites are blocked. The AI filter checks everything else.'
                  : 'Listed sites are blocked. Everything else is allowed.'}
          </p>
          {confirmBlockAll && (
            <div className="mt-3 rounded-lg border border-white/[0.10] p-3">
              <p className="text-caption text-slate-300">
                Block the internet and clear {plural(policy.allowedDomains.length, 'allowed site')}?
              </p>
              <div className="mt-2 flex gap-2">
                <Button
                  variant="ghost"
                  onClick={() => setConfirmBlockAll(false)}
                  className="px-3 py-1.5"
                >
                  Cancel
                </Button>
                <Button onClick={() => void blockEverything(true)} className="px-3 py-1.5">
                  Confirm
                </Button>
              </div>
            </div>
          )}

          <InlineFeedback feedback={feedback.hard} />

          <div className="mt-4 grid gap-5">
            {unlisted !== 'block' && (
              <DomainListEditor
                key={selected?.id}
                title={SMART_FILTERING_ENABLED ? 'Always block' : 'Block list'}
                hint="*.example.com covers subdomains"
                placeholder="reddit.com"
                domains={policy.blockedDomains}
                onAdd={addBlockedDomain}
                onAddMany={addManyBlockedDomains}
                onRemove={removeBlockedDomain}
                max={maxBlocked}
                feedback={feedback.blocked}
                limitReached={blockedLimitReached}
                onUpgrade={onUpgrade}
              />
            )}
            {unlisted === 'block' && (
              <DomainListEditor
                key={selected?.id}
                title="Always allow"
                hint="everything else is blocked"
                placeholder="mail.google.com"
                domains={policy.allowedDomains}
                onAdd={addAllowedDomain}
                onAddMany={addManyAllowedDomains}
                onRemove={removeAllowedDomain}
                max={maxAllowed}
                feedback={feedback.allowed}
                limitReached={allowedLimitReached}
                onUpgrade={onUpgrade}
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
          active={softOn.length > 0 || Boolean(policy.universalSoftBlock)}
          summary={softSummary}
          chips={[
            ...(policy.universalSoftBlock ? ['Universal'] : []),
            ...softOn.map((site) => site.label),
          ]}
          open={openSection === 'soft'}
          onToggle={() => toggleSection('soft')}
        >
          <InlineFeedback feedback={feedback.soft} />
          {blockedLimitReached && (
            <p className="mb-2 text-caption text-slate-400">
              Free limit reached ({maxBlocked} blocked websites, including soft blocks). Remove an
              entry or <UpgradeLink onUpgrade={onUpgrade} /> to add more.
            </p>
          )}
          <SiteRules
            key={selected?.id}
            policy={policy}
            supported={sitesSupported}
            aiMode={aiMode}
            smartAllowed={smartAllowed}
            limitReached={blockedLimitReached}
            onSave={(next) => void save(next, 'soft')}
            onError={(message) => setFeedback('soft', message)}
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
          <p className="text-caption leading-snug text-slate-450">
            {premadeListsLocked
              ? 'Categories with too many sites to list by hand. Premade lists are a Pro feature.'
              : 'Categories with too many sites to list by hand. They block alongside your own lists.'}
          </p>
          <InlineFeedback feedback={feedback.premade} />
          <div className="premade-list-columns mt-3 grid gap-2">
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
                    <span className="text-body font-semibold text-slate-250">{list.label}</span>
                    <span className="ml-2 font-mono text-caption text-slate-500">
                      {list.domainCount.toLocaleString()}
                    </span>
                    <span className="mt-0.5 block text-caption leading-snug text-slate-500">
                      {list.description}
                    </span>
                  </span>
                  <Switch on={enabled} />
                </button>
              );
            })}
          </div>
          {premadeListsLocked && (
            <Button onClick={onUpgrade} className="mt-3 px-4 py-1.5 text-caption">
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
              <p className="text-caption text-slate-400">App blocking is a Pro feature.</p>
              <Button onClick={onUpgrade} className="px-4 py-1.5 text-caption">
                Upgrade to Pro
              </Button>
            </div>
          ) : (
            <>
              <div className="flex gap-2">
                <Button
                  onClick={openAppPicker}
                  disabled={appLimitReached}
                  className="shrink-0 px-4 py-1.5"
                >
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
                <Button
                  variant="ghost"
                  onClick={addApp}
                  disabled={appLimitReached}
                  className="shrink-0 px-4 py-1.5"
                >
                  Add
                </Button>
              </div>
              {appLimitReached && (
                <p className="mt-2 text-caption text-slate-400">
                  Free limit reached ({maxApps} blocked apps). Remove an app or{' '}
                  <UpgradeLink onUpgrade={onUpgrade} /> to add more.
                </p>
              )}
              <InlineFeedback feedback={feedback.apps} />
              <div className="mt-3 flex flex-wrap gap-1.5">
                {policy.apps.map((a) => (
                  <EntryChip
                    key={appKey(a)}
                    label={a.label}
                    detail={appIdentifiers(a)}
                    onRemove={() => removeApp(a)}
                  />
                ))}
                {policy.apps.length === 0 && (
                  <p className="text-caption text-slate-500">
                    These programs get closed whenever this profile is on.
                  </p>
                )}
              </div>
            </>
          )}
        </BlocklistSection>

        {selected && (
          <BlocklistSection
            title="Unlock groups"
            help={
              <>
                Keyless unlocks you allow yourself each day. Unlocking one item in a group opens
                everything in it for the set time.
              </>
            }
            active={pools.length > 0}
            summary={poolsSummary}
            chips={pools.map((pool) => pool.name)}
            open={openSection === 'pools'}
            onToggle={() => toggleSection('pools')}
          >
            <InlineFeedback feedback={feedback.pools} />
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
                    className="text-heading font-semibold text-slate-500"
                  >
                    Choose apps
                  </h2>
                  <p className="mt-2 text-body text-slate-400">
                    {selectedApps.size} selected
                    {maxApps !== null ? ` · ${remainingAppSlots} slots available` : ''}
                  </p>
                </div>
                <button
                  onClick={() => setPickerOpen(false)}
                  className="rounded-lg px-2 py-1 text-caption text-slate-400 hover:bg-white/[0.06] hover:text-white"
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
              {pickerLoading && <p className="p-3 text-body text-slate-500">Loading apps...</p>}
              {pickerError && <p className="p-3 text-body text-dangerInk">{pickerError}</p>}
              {!pickerLoading && !pickerError && filteredPickerItems.length === 0 && (
                <p className="p-3 text-body text-slate-500">No installed apps found.</p>
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
                            <span className="block truncate text-body font-semibold text-slate-100">
                              {item.label}
                            </span>
                            <span className="mt-0.5 block break-words font-mono text-caption text-slate-450">
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

            <div className="px-4 pb-2">
              <InlineFeedback feedback={feedback.picker} />
              {selectedApps.size >= remainingAppSlots && (
                <p className="mt-2 text-caption text-slate-400">
                  All available app slots are selected. Deselect an app to choose another.
                </p>
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
