import { normalizeDomain } from '@talysman/core/browser';

/** Count every pasted entry, using the same host normalization as the policy service. */
export function prepareDomainPaste(raw: string[], existing: string[], room: number) {
  const seen = new Set(existing);
  const additions: string[] = [];
  let duplicates = 0;
  let overLimit = 0;
  let invalid = 0;
  for (const entry of raw) {
    const normalized = normalizeDomain(entry);
    if ('error' in normalized) {
      invalid++;
      continue;
    }
    const domain = normalized.domain;
    if (seen.has(domain)) {
      duplicates++;
      continue;
    }
    seen.add(domain);
    if (additions.length >= Math.max(0, room)) {
      overLimit++;
      continue;
    }
    additions.push(domain);
  }
  return { additions, duplicates, overLimit, invalid };
}
