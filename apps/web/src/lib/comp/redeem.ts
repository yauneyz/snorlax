import "server-only";
import { hashCompCode, looksLikeCompCode } from "@/lib/comp/code";
import { supabaseAdmin } from "@/lib/supabase/admin";

/**
 * Redeeming a complimentary code. The actual work happens in the
 * `redeem_comp_code` SQL function (migration 0004) so that two concurrent
 * attempts on the same single-use code can't both succeed — the code row is
 * locked for the duration of the transaction.
 */

export type RedeemOutcome =
  | "ok"
  | "already_comped"
  | "not_found"
  | "revoked"
  | "expired"
  | "exhausted"
  | "rate_limited";

export interface RedeemResult {
  outcome: RedeemOutcome;
  /** User-facing copy. Deliberately identical for every failure mode that would
   *  otherwise confirm whether a guessed code exists. */
  message: string;
}

const MESSAGES: Record<RedeemOutcome, string> = {
  ok: "You're on Pro. Enjoy!",
  already_comped: "This account already has complimentary Pro.",
  // not_found / revoked / expired / exhausted share one message on purpose:
  // distinguishing them would turn this endpoint into a code oracle.
  not_found: "That code isn't valid.",
  revoked: "That code isn't valid.",
  expired: "That code isn't valid.",
  exhausted: "That code isn't valid.",
  rate_limited: "Too many attempts. Try again in a few minutes.",
};

const MAX_ATTEMPTS = 5;
const WINDOW_MS = 10 * 60 * 1000;

/**
 * Per-process attempt limiter. Codes carry ~40 bits of entropy, so this exists
 * to blunt scripted guessing rather than to be an airtight quota; a serverless
 * deployment runs several instances and each keeps its own counter.
 */
const attempts = new Map<string, { count: number; resetAt: number }>();

function rateLimited(key: string, now = Date.now()): boolean {
  const entry = attempts.get(key);
  if (!entry || entry.resetAt <= now) {
    attempts.set(key, { count: 1, resetAt: now + WINDOW_MS });
    return false;
  }
  entry.count += 1;
  return entry.count > MAX_ATTEMPTS;
}

/** Drop expired buckets so a long-lived instance doesn't grow the map forever. */
function sweep(now = Date.now()): void {
  for (const [key, entry] of attempts) {
    if (entry.resetAt <= now) attempts.delete(key);
  }
}

export async function redeemCompCode(args: {
  userId: string;
  code: string;
  /** Client IP, when the caller can determine one. Limited alongside the user id. */
  ip?: string | null;
}): Promise<RedeemResult> {
  const { userId, code, ip } = args;

  sweep();
  const limited = [`user:${userId}`, ip ? `ip:${ip}` : null]
    .filter((key): key is string => key !== null)
    .map((key) => rateLimited(key))
    .some(Boolean);
  if (limited) return { outcome: "rate_limited", message: MESSAGES.rate_limited };

  if (!looksLikeCompCode(code)) {
    return { outcome: "not_found", message: MESSAGES.not_found };
  }

  const { data, error } = await supabaseAdmin().rpc("redeem_comp_code", {
    p_code_hash: hashCompCode(code),
    p_user_id: userId,
  });
  if (error) throw new Error(`Failed to redeem code: ${error.message}`);

  const outcome = (data ?? "not_found") as RedeemOutcome;
  return { outcome, message: MESSAGES[outcome] ?? MESSAGES.not_found };
}
