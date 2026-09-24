/**
 * The AI judge wire contract, shared by the daemon RPCs/events, Electron main, and the web judge
 * endpoint. Every `judge` action in a policy resolves through this flow:
 *
 *   extension ──judge-request──▶ natmsg ──judgeRequest──▶ daemon ──judgeRequested──▶ Electron main
 *   ──POST /api/desktop/judge──▶ LLM ──▶ submitJudgeVerdict ──▶ daemon ──judgeResult──▶ extension
 *
 * The daemon attaches the active `JudgePolicy` (tasks/avoid) itself; the extension never sends
 * it. Anything that doesn't answer in time resolves to `JudgePolicy.fallback`.
 */
import type { JudgePolicy } from './policy.js';

export type JudgeVerdict = 'allow' | 'block';

/** Which rule sent the page to the judge. Absent ⇒ `defaultAction: 'judge'` on an unlisted page. */
export interface JudgeContext {
  site: string;
  feature: string;
}

/** Page content the extension extracted for judging. */
export interface JudgePage {
  url: string;
  title: string;
  /** Visible text, focused on the route's content selector when the catalog provides one. */
  content: string;
  context?: JudgeContext;
}

/** Bounds enforced by the daemon and the web endpoint. */
export const JUDGE_LIMITS = {
  requestId: 128,
  url: 4096,
  title: 300,
  content: 4000,
} as const;

/** What Electron main posts to the web judge endpoint. */
export interface JudgeHttpRequest extends JudgePage {
  judge: Pick<JudgePolicy, 'tasks' | 'avoid'>;
}

export interface JudgeHttpResponse {
  verdict: JudgeVerdict;
  reason: string;
}
