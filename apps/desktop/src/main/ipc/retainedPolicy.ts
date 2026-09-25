import { app } from 'electron';
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import type { Policy } from '@talysman/shared';

const FILE_NAME = 'retained-pro-policy.json';

export interface RetainedPolicy {
  version: 1;
  profileId: string;
  policy: Policy;
  freeProjection: Policy;
}

function filePath(): string {
  return join(app.getPath('userData'), FILE_NAME);
}

export async function readRetainedPolicy(): Promise<RetainedPolicy | null> {
  try {
    const value: unknown = JSON.parse(await readFile(filePath(), 'utf8'));
    const record = value as Partial<RetainedPolicy> | null;
    if (!record || typeof record !== 'object') {
      throw new Error('Invalid retained Pro policy.');
    }
    if (record.version !== 1 || typeof record.profileId !== 'string'
      || !Array.isArray(record.policy?.blockedDomains)
      || !Array.isArray(record.freeProjection?.blockedDomains)
      || !record.policy?.sites || !record.freeProjection?.sites) {
      throw new Error('Invalid retained Pro policy.');
    }
    return record as RetainedPolicy;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw error;
  }
}

/** Persist before sending the smaller policy to the service, so a failed write cannot lose rules. */
export async function writeRetainedPolicy(value: RetainedPolicy): Promise<void> {
  const path = filePath();
  const temporary = `${path}.${randomUUID()}.tmp`;
  await mkdir(dirname(path), { recursive: true });
  try {
    await writeFile(temporary, `${JSON.stringify(value)}\n`, { encoding: 'utf8', mode: 0o600 });
    await rename(temporary, path);
  } finally {
    await rm(temporary, { force: true });
  }
}

export async function clearRetainedPolicy(): Promise<void> {
  await rm(filePath(), { force: true });
}

function unchanged<T>(current: T, projected: T): boolean {
  return JSON.stringify(current) === JSON.stringify(projected);
}

/** Keep edits made on Free while putting the hidden Pro rules back in their original order. */
export function restorePolicy(current: Policy, retained: RetainedPolicy): Policy {
  const { policy: original, freeProjection: free } = retained;
  const visibleDomains = new Set(free.blockedDomains);
  const blockedDomains = [...current.blockedDomains];
  for (const domain of original.blockedDomains) {
    if (!visibleDomains.has(domain) && !blockedDomains.includes(domain)) blockedDomains.push(domain);
  }

  const sites = { ...current.sites };
  for (const [id, rule] of Object.entries(original.sites)) {
    if (!(id in free.sites) && !(id in sites)) sites[id] = rule;
  }

  return {
    ...original,
    blockedDomains,
    sites,
    allowedDomains: unchanged(current.allowedDomains, free.allowedDomains)
      ? original.allowedDomains : current.allowedDomains,
    defaultAction: current.defaultAction === free.defaultAction
      ? original.defaultAction : current.defaultAction,
    judge: unchanged(current.judge, free.judge) ? original.judge : current.judge,
    apps: unchanged(current.apps, free.apps) ? original.apps : current.apps,
    enabledPremadeLists: unchanged(current.enabledPremadeLists, free.enabledPremadeLists)
      ? original.enabledPremadeLists : current.enabledPremadeLists,
  };
}
