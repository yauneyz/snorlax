import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { EMPTY_POLICY, type Policy } from '@talysman/shared';
import { constrainPolicyToLimits, limitsForPlan } from '../../../apps/desktop/src/shared/productLimits.js';
import {
  clearRetainedPolicy,
  readRetainedPolicy,
  restorePolicy,
  writeRetainedPolicy,
  type RetainedPolicy,
} from '../../../apps/desktop/src/main/ipc/retainedPolicy.js';

let dataDir: string;
vi.mock('electron', () => ({ app: { getPath: () => dataDir } }));

const original: Policy = {
  ...EMPTY_POLICY,
  blockedDomains: ['one.com', 'two.com', 'three.com', 'four.com', 'five.com', 'six.com', 'seven.com'],
  apps: [{ windowsImageName: 'game.exe', label: 'Game' }],
  enabledPremadeLists: ['shopping'],
  sites: { youtube: { features: {} } },
};

const freeProjection = constrainPolicyToLimits(original, limitsForPlan('free'));
const retained: RetainedPolicy = {
  version: 1,
  profileId: 'default',
  policy: original,
  freeProjection,
};

describe('retained Pro policy', () => {
  it('persists the full policy across reads and clears it after restoration', async () => {
    dataDir = await mkdtemp(join(tmpdir(), 'talysman-retained-policy-'));
    try {
      await writeRetainedPolicy(retained);
      expect(await readRetainedPolicy()).toEqual(retained);
      await clearRetainedPolicy();
      expect(await readRetainedPolicy()).toBeNull();
    } finally {
      await rm(dataDir, { recursive: true, force: true });
    }
  });

  it('restores the complete blocklist and Pro rules after a downgrade', () => {
    expect(freeProjection.blockedDomains).toHaveLength(5);
    expect(restorePolicy(freeProjection, retained)).toEqual(original);
  });

  it('keeps Free blocklist edits while restoring only the hidden sites', () => {
    const edited: Policy = {
      ...freeProjection,
      blockedDomains: ['one.com', 'three.com', 'new.com'],
      sites: { reddit: { features: {} } },
    };

    const restored = restorePolicy(edited, retained);
    expect(restored.blockedDomains).toEqual([
      'one.com', 'three.com', 'new.com', 'six.com', 'seven.com',
    ]);
    expect(restored.sites).toEqual({ reddit: { features: {} }, youtube: { features: {} } });
    expect(restored.apps).toEqual(original.apps);
    expect(restored.enabledPremadeLists).toEqual(original.enabledPremadeLists);
  });
});
