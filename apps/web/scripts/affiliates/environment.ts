import fs from "node:fs";
import path from "node:path";
import toml from "@iarna/toml";
import { loadCompEnvironment, type CompEnvironment, type CompMode } from "../comp-environment";

export type AffiliatesEnvironment = CompEnvironment & {
  /** Null when .credentials has no Stripe key for this mode; earnings are then unavailable. */
  stripeSecretKey: string | null;
};

/**
 * Same target selection and safety checks as `pnpm comp` (prod by default, --dev for local
 * Supabase), plus the Stripe key for that mode: live for prod, test for dev.
 */
export function loadAffiliatesEnvironment(mode: CompMode): AffiliatesEnvironment {
  const environment = loadCompEnvironment(mode);
  const root = path.resolve(__dirname, "../../../..");
  const source = [
    path.join(root, ".credentials"),
    path.resolve(root, "..", "indigo", ".credentials"),
  ].find((candidate) => fs.existsSync(candidate));
  const stripe = source
    ? (toml.parse(fs.readFileSync(source, "utf8")).stripe as Record<string, unknown> | undefined)
    : undefined;
  const key = stripe?.[mode === "prod" ? "secret_key_live" : "secret_key_test"];
  return {
    ...environment,
    stripeSecretKey: typeof key === "string" && key.length > 0 ? key : null,
  };
}
