/**
 * AI judge bridge (see packages/shared/src/judge.ts for the full flow). Whenever a policy rule
 * resolves to `judge` for a page — a judged `defaultAction`, or a site feature set to "AI decides"
 * — the daemon broadcasts `judgeRequested` and waits for `submitJudgeVerdict`. Electron main is the
 * only client with the user's Supabase session, so it turns the request into a call to the web
 * backend's judge endpoint and reports the verdict back.
 *
 * The daemon captures the active judge policy (tasks, avoid list) into each `judgeRequested`
 * event. That keeps a request self-contained and prevents a profile switch or task edit racing
 * with Electron from judging the page against the wrong tasks.
 *
 * Failure handling is deliberately silent: if the web call fails or times out, we simply never
 * call `submitJudgeVerdict`. The daemon's own timeout sweep answers with the judge's fallback —
 * that backstop is what makes it safe to drop these requests on the floor rather than retry them.
 */

import type { EventPayload, JudgeHttpRequest, JudgeHttpResponse } from '@talysman/shared';
import { config } from './config.js';
import { logger } from './logging.js';
import { getAccessToken } from './auth/supabase.js';
import type { ServiceConnection } from './service/connection.js';
import { aiModeEnabledSync } from './aiMode.js';

// Leave time for the daemon to receive the result before its 8-second authoritative fallback.
const JUDGE_FETCH_TIMEOUT_MS = 6_000;

type JudgeRequested = EventPayload<'judgeRequested'>;

async function callJudgeEndpoint(token: string, request: JudgeRequested): Promise<JudgeHttpResponse> {
  const endpoint = `${config.apiBaseUrl}/api/desktop/judge`;
  const startedAt = Date.now();
  const body: JudgeHttpRequest = {
    url: request.url,
    title: request.title,
    content: request.content,
    ...(request.context ? { context: request.context } : {}),
    judge: { tasks: request.judge.tasks, avoid: request.judge.avoid },
  };
  const res = await fetch(endpoint, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      'X-Talysman-Judge-Request-Id': request.requestId,
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(JUDGE_FETCH_TIMEOUT_MS),
  });
  logger.info('[judge] endpoint responded', {
    requestId: request.requestId,
    status: res.status,
    elapsedMs: Date.now() - startedAt,
  });
  if (!res.ok) {
    const errorBody = await res.text();
    throw new Error(`judge request failed: ${res.status} ${errorBody.slice(0, 300)}`);
  }
  const verdict = (await res.json()) as Partial<JudgeHttpResponse>;
  if ((verdict.verdict !== 'allow' && verdict.verdict !== 'block') || typeof verdict.reason !== 'string') {
    throw new Error('judge response missing verdict/reason');
  }
  return { verdict: verdict.verdict, reason: verdict.reason };
}

/**
 * Subscribe to the daemon's AI judge requests. Call once at startup alongside `createTray` /
 * `registerIpcHandlers` (see index.ts).
 */
export function initSmartFiltering(service: ServiceConnection): void {
  logger.info('[judge] listener initialized', { apiBaseUrl: config.apiBaseUrl });
  service.on('judgeRequested', (request) => {
    logger.info('[judge] judgeRequested received', {
      requestId: request.requestId,
      url: request.url,
      contentLength: request.content.length,
      context: request.context,
    });
    void handleJudgeRequested(service, request);
  });
}

async function handleJudgeRequested(service: ServiceConnection, request: JudgeRequested): Promise<void> {
  // With AI mode off the daemon never asks (its capability flag is off), but another client
  // sharing the daemon could turn it on. Never send page content to the judge while opted out.
  if (!aiModeEnabledSync()) {
    logger.info(`[judge] skipping judgeRequested ${request.requestId}: AI mode is off`);
    return;
  }
  const token = await getAccessToken();
  if (!token) {
    logger.warn(`[judge] skipping judgeRequested ${request.requestId}: no auth session`);
    return;
  }

  let verdict: JudgeHttpResponse;
  try {
    verdict = await callJudgeEndpoint(token, request);
  } catch (e) {
    // Expected occasionally (network blips, endpoint timeouts). Never retried, never surfaced to
    // the user — the daemon's timeout sweep produces the fallback verdict.
    logger.warn(`[judge] call failed for ${request.requestId}: ${(e as Error).message}`);
    return;
  }

  try {
    await service.request('submitJudgeVerdict', { requestId: request.requestId, ...verdict });
    logger.info('[judge] verdict accepted by daemon', { requestId: request.requestId, verdict: verdict.verdict });
  } catch (e) {
    logger.warn(`[judge] submitJudgeVerdict failed for ${request.requestId}: ${(e as Error).message}`);
  }
}
