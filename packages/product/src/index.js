import { z } from 'zod';
export const SUBSCRIPTION_PLANS = ['free', 'pro'];
export const CHECKOUT_PRICES = ['monthly', 'yearly'];
export const subscriptionPlanSchema = z.enum(SUBSCRIPTION_PLANS);
export const checkoutPriceSchema = z.enum(CHECKOUT_PRICES);
export const entitlementSourceSchema = z.enum([
    'stub',
    'dev-override',
    'local-license',
    'server',
    'cache',
    'offline',
]);
export const entitlementSchema = z.object({
    active: z.boolean(),
    plan: subscriptionPlanSchema,
    source: entitlementSourceSchema,
    status: z.string().optional(),
    currentPeriodEnd: z.string().optional(),
    fetchedAt: z.string().optional(),
    cacheUntil: z.string().optional(),
});
const FREE_LIMITS = {
    policy: {
        modes: ['blacklist', 'block-all'],
        maxDomains: 5,
        maxApps: 0,
    },
    schedule: {
        enabled: false,
    },
};
export function entitlementForPlan(plan, source, metadata = {}) {
    return { active: plan === 'pro', plan, source, ...metadata };
}
export function limitsForPlan(plan) {
    return plan === 'free' ? FREE_LIMITS : null;
}
export function isScheduleEnabled(limits) {
    return limits?.schedule?.enabled !== false;
}
export function allowedPolicyModes(limits) {
    return limits?.policy?.modes ?? null;
}
export function maxPolicyDomains(limits) {
    return limits?.policy?.maxDomains ?? null;
}
export function maxPolicyApps(limits) {
    return limits?.policy?.maxApps ?? null;
}
export function validatePolicyForLimits(policy, limits) {
    if (!limits?.policy)
        return [];
    const violations = [];
    const modes = allowedPolicyModes(limits);
    const maxDomains = maxPolicyDomains(limits);
    const maxApps = maxPolicyApps(limits);
    if (modes && !modes.includes(policy.mode)) {
        violations.push({
            field: 'policy.mode',
            message: 'Free supports blacklist and block-all modes only.',
        });
    }
    if (maxDomains !== null && policy.domains.length > maxDomains) {
        violations.push({
            field: 'policy.domains',
            message: `Free supports up to ${maxDomains} blocked websites.`,
        });
    }
    if (maxApps !== null && policy.apps.length > maxApps) {
        violations.push({
            field: 'policy.apps',
            message: 'Free does not include app blocking.',
        });
    }
    return violations;
}
export function validateScheduleForLimits(schedule, limits) {
    if (isScheduleEnabled(limits) || schedule.windows.length === 0)
        return [];
    return [{ field: 'schedule', message: 'Free does not include scheduling.' }];
}
export function constrainPolicyToLimits(policy, limits) {
    if (!limits?.policy)
        return policy;
    const modes = allowedPolicyModes(limits);
    const maxDomains = maxPolicyDomains(limits);
    const maxApps = maxPolicyApps(limits);
    return {
        mode: modes?.includes(policy.mode) ? policy.mode : modes?.[0] ?? policy.mode,
        domains: maxDomains === null ? policy.domains : policy.domains.slice(0, maxDomains),
        apps: maxApps === null ? policy.apps : policy.apps.slice(0, maxApps),
    };
}
export function constrainScheduleToLimits(schedule, limits) {
    return isScheduleEnabled(limits) ? schedule : { windows: [] };
}
//# sourceMappingURL=index.js.map
