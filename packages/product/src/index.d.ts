import { z } from 'zod';
import type { Mode, Policy, Schedule } from '@talysman/shared';
export declare const SUBSCRIPTION_PLANS: readonly ["free", "pro"];
export declare const CHECKOUT_PRICES: readonly ["monthly", "yearly"];
export declare const subscriptionPlanSchema: z.ZodEnum<["free", "pro"]>;
export declare const checkoutPriceSchema: z.ZodEnum<["monthly", "yearly"]>;
export type SubscriptionPlan = z.infer<typeof subscriptionPlanSchema>;
export type CheckoutPrice = z.infer<typeof checkoutPriceSchema>;
export declare const entitlementSourceSchema: z.ZodEnum<["stub", "dev-override", "local-license", "server", "cache", "offline"]>;
export type EntitlementSource = z.infer<typeof entitlementSourceSchema>;
export declare const entitlementSchema: z.ZodObject<{
    active: z.ZodBoolean;
    plan: z.ZodEnum<["free", "pro"]>;
    source: z.ZodEnum<["stub", "dev-override", "local-license", "server", "cache", "offline"]>;
    status: z.ZodOptional<z.ZodString>;
    currentPeriodEnd: z.ZodOptional<z.ZodString>;
    fetchedAt: z.ZodOptional<z.ZodString>;
    cacheUntil: z.ZodOptional<z.ZodString>;
}, "strip", z.ZodTypeAny, {
    active: boolean;
    plan: "free" | "pro";
    source: "stub" | "dev-override" | "local-license" | "server" | "cache" | "offline";
    status?: string | undefined;
    currentPeriodEnd?: string | undefined;
    fetchedAt?: string | undefined;
    cacheUntil?: string | undefined;
}, {
    active: boolean;
    plan: "free" | "pro";
    source: "stub" | "dev-override" | "local-license" | "server" | "cache" | "offline";
    status?: string | undefined;
    currentPeriodEnd?: string | undefined;
    fetchedAt?: string | undefined;
    cacheUntil?: string | undefined;
}>;
export type Entitlement = z.infer<typeof entitlementSchema>;
type LimitedValue = number | null;
export interface ProductLimits {
    policy?: {
        modes?: readonly Mode[];
        maxDomains?: LimitedValue;
        maxApps?: LimitedValue;
    };
    schedule?: {
        enabled?: boolean;
    };
}
export interface LimitViolation {
    field: 'policy.mode' | 'policy.domains' | 'policy.apps' | 'schedule';
    message: string;
}
export declare function entitlementForPlan(plan: SubscriptionPlan, source: EntitlementSource, metadata?: Omit<Partial<Entitlement>, 'active' | 'plan' | 'source'>): Entitlement;
export declare function limitsForPlan(plan: SubscriptionPlan): ProductLimits | null;
export declare function isScheduleEnabled(limits: ProductLimits | null): boolean;
export declare function allowedPolicyModes(limits: ProductLimits | null): readonly Mode[] | null;
export declare function maxPolicyDomains(limits: ProductLimits | null): LimitedValue;
export declare function maxPolicyApps(limits: ProductLimits | null): LimitedValue;
export declare function validatePolicyForLimits(policy: Policy, limits: ProductLimits | null): LimitViolation[];
export declare function validateScheduleForLimits(schedule: Schedule, limits: ProductLimits | null): LimitViolation[];
export declare function constrainPolicyToLimits(policy: Policy, limits: ProductLimits | null): Policy;
export declare function constrainScheduleToLimits(schedule: Schedule, limits: ProductLimits | null): Schedule;
export {};
