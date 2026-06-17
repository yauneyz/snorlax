import { requireSubscribed } from "@/lib/auth/require-subscribed";

/**
 * Single server-side gate for authenticated UI routes.
 * Anonymous users are redirected to /login; signed-in users without an active
 * subscription are redirected to /pricing.
 */
export const requireAuthenticatedUiRoute = requireSubscribed;
