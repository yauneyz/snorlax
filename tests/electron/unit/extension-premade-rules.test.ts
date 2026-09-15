import { describe, expect, it } from 'vitest';

import { buildPremadeRulePlan } from '../../../apps/extension/src/premade-rules.js';
import { PREMADE_RULESETS } from '../../../apps/extension/src/premade-rulesets.js';

describe('packed extension premade rules', () => {
  it('disables every container while focus is inactive', () => {
    const plan = buildPremadeRulePlan(false, ['nsfw']);
    expect(plan.updates).toEqual([]);
    expect(plan.enableRulesetIds).toEqual([]);
    expect(plan.disableRulesetIds).toEqual(Object.keys(PREMADE_RULESETS.rulesets));
    expect(plan.enabledRuleCount).toBe(0);
  });

  it('enables only the rule ids belonging to the selected category', () => {
    const plan = buildPremadeRulePlan(true, ['shopping']);
    const mapped = Object.values(PREMADE_RULESETS.ruleIdsByList.shopping).flat();
    expect(plan.enabledRuleCount).toBe(mapped.length);
    expect(plan.enabledRuleCount).toBeGreaterThan(0);
    expect(plan.updates.flatMap((update) => update.enableRuleIds).sort((a, b) => a - b)).toEqual(
      [...mapped].sort((a, b) => a - b),
    );
  });

  it('fits every category combination into the five packed containers', () => {
    const categories = Object.keys(PREMADE_RULESETS.ruleIdsByList);
    const plan = buildPremadeRulePlan(true, categories);
    const totalRules = Object.values(PREMADE_RULESETS.rulesets).flat().length;
    expect(plan.enabledRuleCount).toBe(totalRules);
    expect(plan.enableRulesetIds).toHaveLength(5);
    expect(plan.disableRulesetIds).toEqual([]);
    expect(plan.updates.every((update) => update.disableRuleIds.length === 0)).toBe(true);
  });
});
