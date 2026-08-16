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

import type { AppRef, Policy, PolicyIntent } from '@talysman/shared';

export interface NormalizedPolicy extends Policy {
  /** Inputs that were dropped during normalization, with a reason. */
  rejected: { value: string; reason: string }[];
}

/** Prompt-budget cap for each intent field; also keeps the UI textarea sane. */
export const INTENT_FIELD_MAX_LENGTH = 500;

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

/**
 * Normalize a user-authored intent. `positive` is required for a non-null result — an intent
 * with a blank/whitespace-only description is dropped (Smart filtering stays off) rather than
 * silently enforced against nothing.
 */
function normalizeIntent(
  intent: PolicyIntent | null | undefined,
  rejected: { value: string; reason: string }[],
): PolicyIntent | null {
  if (!intent) return null;

  const positive = (intent.positive ?? '').trim().slice(0, INTENT_FIELD_MAX_LENGTH);
  if (!positive) {
    rejected.push({ value: intent.positive ?? '', reason: 'intent needs a non-empty description' });
    return null;
  }

  const negative = (intent.negative ?? '').trim().slice(0, INTENT_FIELD_MAX_LENGTH);
  return negative ? { positive, negative } : { positive };
}

/** Normalize and validate an entire policy. */
export function normalizePolicy(policy: Policy): NormalizedPolicy {
  const rejected: { value: string; reason: string }[] = [];

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

  const defaultAction: Policy['defaultAction'] = policy.defaultAction === 'block' ? 'block' : 'allow';
  const intent = normalizeIntent(policy.intent, rejected);

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

  return { blockedDomains, allowedDomains, defaultAction, intent, apps, rejected };
}
