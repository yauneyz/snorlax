import { PREMADE_RULESETS } from './premade-rulesets.js';

/** Build a pure update plan for the packed static rulesets. */
export function buildPremadeRulePlan(active, enabledPremadeLists) {
  const wanted = new Set(active ? enabledPremadeLists : []);
  const wantedByRuleset = Object.fromEntries(
    Object.keys(PREMADE_RULESETS.rulesets).map((rulesetId) => [rulesetId, new Set()]),
  );
  for (const listId of wanted) {
    for (const [rulesetId, ruleIds] of Object.entries(
      PREMADE_RULESETS.ruleIdsByList[listId] ?? {},
    )) {
      for (const ruleId of ruleIds) wantedByRuleset[rulesetId].add(ruleId);
    }
  }

  const updates = [];
  const enableRulesetIds = [];
  const disableRulesetIds = [];
  let enabledRuleCount = 0;
  for (const [rulesetId, allRuleIds] of Object.entries(PREMADE_RULESETS.rulesets)) {
    const enableSet = wantedByRuleset[rulesetId];
    const enableRuleIds = [...enableSet];
    if (enableRuleIds.length > 0) {
      updates.push({
        rulesetId,
        enableRuleIds,
        disableRuleIds: allRuleIds.filter((ruleId) => !enableSet.has(ruleId)),
      });
      enableRulesetIds.push(rulesetId);
      enabledRuleCount += enableRuleIds.length;
    } else {
      disableRulesetIds.push(rulesetId);
    }
  }
  return { updates, enableRulesetIds, disableRulesetIds, enabledRuleCount };
}
