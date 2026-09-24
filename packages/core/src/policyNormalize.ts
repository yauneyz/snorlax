/**
 * Pure validation/normalization of a user-authored policy into the clean form the privileged
 * service enforces (architecture §7). The service receives only normalized input and never
 * has to parse user free-text.
 *
 * Domain rules:
 *  - lowercased, trimmed, surrounding scheme/path stripped ("https://YouTube.com/x" → "youtube.com")
 *  - a single leading "*." wildcard is preserved (matches the domain + all subdomains)
 *  - obviously-invalid entries are dropped (collected in `rejected` for UI feedback)
 *  - de-duplicated, order-stable
 */

import type { AppRef, JudgePolicy, JudgeTask, Policy, PremadeListId, RuleAction, SiteRule } from '@talysman/shared';
import { PREMADE_LISTS, siteDefinition } from '@talysman/shared';

export interface NormalizedPolicy extends Policy {
  /** Inputs that were dropped during normalization, with a reason. */
  rejected: { value: string; reason: string }[];
}

/** Prompt-budget caps for the judge configuration; also keep the UI inputs sane. */
export const JUDGE_TEXT_MAX_LENGTH = 500;
export const JUDGE_MAX_TASKS = 20;
export const JUDGE_MAX_AVOID = 20;

/**
 * The pre-v5 policy fields. Old daemons, persisted profiles, and old fixtures still carry them;
 * `migrateLegacyPolicy` folds them into the current shape. Permanent (not transitional): old
 * state files must keep loading.
 */
export interface LegacyPolicyFields {
  softBlockedSites?: string[];
  intent?: { positive?: string; negative?: string } | null;
}

// A liberal hostname label check. Each label: alphanumeric + hyphen, not leading/trailing hyphen.
const LABEL_RE = /^(?!-)[a-z0-9-]{1,63}(?<!-)$/;

function stripToHost(input: string): string {
  let s = input.trim().toLowerCase();
  // Strip scheme.
  s = s.replace(/^[a-z][a-z0-9+.-]*:\/\//, '');
  // Strip credentials@, path, query, port.
  s = s.replace(/^[^/@]*@/, '');
  s = s.split('/')[0] ?? s;
  s = s.split('?')[0] ?? s;
  s = s.split(':')[0] ?? s;
  return s.trim();
}

/** Normalize a single domain string. Returns null with a reason if invalid. */
export function normalizeDomain(input: string): { domain: string } | { error: string } {
  const raw = input.trim();
  if (!raw) return { error: 'empty' };

  let wildcard = false;
  let host = stripToHost(raw);

  if (host.startsWith('*.')) {
    wildcard = true;
    host = host.slice(2);
  }
  if (host.startsWith('.')) host = host.slice(1);

  if (!host) return { error: 'no host' };
  if (host.includes('*')) return { error: 'wildcard only allowed as a leading "*."' };

  const labels = host.split('.');
  if (labels.length < 2) return { error: 'must have at least two labels (e.g. example.com)' };
  for (const label of labels) {
    if (!LABEL_RE.test(label)) return { error: `invalid label "${label}"` };
  }

  return { domain: wildcard ? `*.${host}` : host };
}

function normalizeApp(app: AppRef): AppRef | null {
  const label = app.label?.trim();
  const win = app.windowsImageName?.trim().toLowerCase();
  const linux = app.linuxProcessName?.trim().toLowerCase();
  const mac = app.macBundleId?.trim();
  if (!win && !linux && !mac) return null; // nothing to match on
  return {
    label: label || win || linux || mac || 'app',
    ...(win ? { windowsImageName: win } : {}),
    ...(linux ? { linuxProcessName: linux } : {}),
    ...(mac ? { macBundleId: mac } : {}),
  };
}

/** Normalize a domain list against its own `normalizeDomain` rules, deduped, order-stable. */
function normalizeDomainList(
  input: string[] | undefined,
  rejected: { value: string; reason: string }[],
): string[] {
  const seen = new Set<string>();
  const domains: string[] = [];
  for (const d of input ?? []) {
    const res = normalizeDomain(d);
    if ('error' in res) {
      rejected.push({ value: d, reason: res.error });
      continue;
    }
    if (!seen.has(res.domain)) {
      seen.add(res.domain);
      domains.push(res.domain);
    }
  }
  return domains;
}

const ACTIONS: readonly RuleAction[] = ['allow', 'judge', 'block'];

function isAction(value: unknown): value is RuleAction {
  return typeof value === 'string' && (ACTIONS as readonly string[]).includes(value);
}

/**
 * Fold legacy `softBlockedSites`/`intent` into `sites`/`judge`. A legacy intent meant "judge every
 * unlisted page, falling back to defaultAction", which is `defaultAction: 'judge'` with that
 * fallback. Current-shape input passes through untouched.
 */
export function migrateLegacyPolicy(input: Partial<Policy> & LegacyPolicyFields): Partial<Policy> {
  const { softBlockedSites, intent, ...rest } = input;
  const out: Partial<Policy> = { ...rest };
  if (!out.sites && Array.isArray(softBlockedSites)) {
    out.sites = Object.fromEntries(softBlockedSites.map((id) => [id, { features: {} }]));
  }
  if (out.judge === undefined && intent !== undefined) {
    const positive = intent?.positive?.trim();
    if (positive) {
      const fallback = out.defaultAction === 'block' ? 'block' : 'allow';
      out.judge = {
        tasks: [{ id: 'task-1', title: positive }],
        avoid: intent?.negative?.trim() ? [intent.negative.trim()] : [],
        fallback,
      };
      out.defaultAction = 'judge';
    } else {
      out.judge = null;
    }
  }
  return out;
}

function clip(value: unknown): string {
  return typeof value === 'string' ? value.trim().slice(0, JUDGE_TEXT_MAX_LENGTH) : '';
}

/** Normalize the judge configuration. A judge with no task is dropped: there is nothing to judge against. */
function normalizeJudge(
  judge: JudgePolicy | null | undefined,
  rejected: { value: string; reason: string }[],
): JudgePolicy | null {
  if (!judge) return null;
  const tasks: JudgeTask[] = [];
  const ids = new Set<string>();
  for (const task of judge.tasks ?? []) {
    const title = clip(task?.title);
    if (!title) continue;
    let id = clip(task.id) || `task-${tasks.length + 1}`;
    while (ids.has(id)) id = `${id}-${tasks.length + 1}`;
    ids.add(id);
    const notes = clip(task.notes);
    tasks.push(notes ? { id, title, notes } : { id, title });
    if (tasks.length === JUDGE_MAX_TASKS) break;
  }
  if (tasks.length === 0) {
    rejected.push({ value: 'judge', reason: 'AI filtering needs at least one task' });
    return null;
  }
  const avoid = [...new Set((judge.avoid ?? []).map(clip).filter(Boolean))].slice(0, JUDGE_MAX_AVOID);
  return { tasks, avoid, fallback: judge.fallback === 'block' ? 'block' : 'allow' };
}

/**
 * Normalize site rules against the catalog: unknown sites and features are rejected; overrides of
 * locked features and overrides equal to the catalog default are dropped so stored policies stay
 * minimal and pick up improved defaults.
 */
function normalizeSites(
  sites: Record<string, SiteRule> | undefined,
  rejected: { value: string; reason: string }[],
): Record<string, SiteRule> {
  const out: Record<string, SiteRule> = {};
  for (const [id, rule] of Object.entries(sites ?? {})) {
    const site = siteDefinition(id);
    if (!site) {
      rejected.push({ value: id, reason: 'unknown site' });
      continue;
    }
    const features: SiteRule['features'] = {};
    for (const [featureId, action] of Object.entries(rule?.features ?? {})) {
      const feature = site.features.find((f) => f.id === featureId);
      if (!feature || !isAction(action)) {
        rejected.push({ value: `${id}.${featureId}`, reason: 'unknown site feature or action' });
        continue;
      }
      if (feature.locked || action === feature.default) continue;
      features[featureId] = action;
    }
    out[id] = { features };
  }
  return out;
}

/** Normalize and validate an entire policy. */
export function normalizePolicy(input: Policy | (Partial<Policy> & LegacyPolicyFields)): NormalizedPolicy {
  const rejected: { value: string; reason: string }[] = [];
  const policy = migrateLegacyPolicy(input);

  const blockedDomains = normalizeDomainList(policy.blockedDomains, rejected);
  const blockedSet = new Set(blockedDomains);

  const allowedCandidates = normalizeDomainList(policy.allowedDomains, rejected);
  const allowedDomains: string[] = [];
  for (const d of allowedCandidates) {
    if (blockedSet.has(d)) {
      rejected.push({ value: d, reason: 'also on the block list; block wins' });
      continue;
    }
    allowedDomains.push(d);
  }

  const judge = normalizeJudge(policy.judge, rejected);
  let defaultAction: RuleAction = isAction(policy.defaultAction) ? policy.defaultAction : 'allow';
  // Without a judge, `judge` actions resolve to allow at enforcement; say so explicitly.
  if (defaultAction === 'judge' && !judge) defaultAction = 'allow';

  const appSeen = new Set<string>();
  const apps: AppRef[] = [];
  for (const a of policy.apps ?? []) {
    const n = normalizeApp(a);
    if (!n) {
      rejected.push({
        value: a.label ?? '(app)',
        reason: 'no windowsImageName, linuxProcessName, or macBundleId',
      });
      continue;
    }
    const key = `${n.windowsImageName ?? ''}|${n.linuxProcessName ?? ''}|${n.macBundleId ?? ''}`;
    if (!appSeen.has(key)) {
      appSeen.add(key);
      apps.push(n);
    }
  }

  const knownListIds = new Set<PremadeListId>(PREMADE_LISTS.map((l) => l.id));
  const enabledPremadeLists: PremadeListId[] = [];
  const premadeSeen = new Set<PremadeListId>();
  for (const id of policy.enabledPremadeLists ?? []) {
    if (!knownListIds.has(id)) {
      rejected.push({ value: id, reason: 'unknown premade list id' });
      continue;
    }
    if (!premadeSeen.has(id)) {
      premadeSeen.add(id);
      enabledPremadeLists.push(id);
    }
  }

  const sites = normalizeSites(policy.sites, rejected);

  return {
    blockedDomains,
    allowedDomains,
    defaultAction,
    judge,
    apps,
    enabledPremadeLists,
    sites,
    rejected,
  };
}
