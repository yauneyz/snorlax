/**
 * Smart filtering (architecture §7 / judge protocol). When a browser-extension page falls through
 * both of a `Policy.intent`-enabled profile's hard lists, the daemon broadcasts `judgeRequested`
 * and waits for `submitJudgeVerdict`. Electron main is the only client with the user's Supabase
 * session, so it is the one that turns the request into a call to the web backend's judge
 * endpoint and reports the verdict back.
 *
 * The daemon captures the active intent into each `judgeRequested` event. That keeps a request
 * self-contained and prevents a profile switch racing with Electron from judging the page against
 * the wrong intent.
 *
 * Failure handling is deliberately silent: if `intent` is null (the active profile changed out
 * from under the request), or the web call fails/times out, we simply never call
 * `submitJudgeVerdict`. The daemon's own timeout sweep answers with the fail-closed/fail-open
 * fallback per `Policy.defaultAction` — that backstop is what makes it safe to drop these
 * requests on the floor rather than retry them.
 */

import type { PolicyIntent } from '@talysman/shared';
import { config } from './config.js';
import { logger } from './logging.js';
import { getAccessToken } from './auth/supabase.js';
import type { ServiceConnection } from './service/connection.js';

// Leave time for the daemon to receive the result before its 8-second authoritative fallback.
const JUDGE_FETCH_TIMEOUT_MS = 6_000;

interface JudgeIntentResponse {
  relevant: boolean;
  reason: string;
}

async function callJudgeEndpoint(
  requestId: string,
  token: string,
  url: string,
  extractedText: string,
  intent: PolicyIntent,
): Promise<JudgeIntentResponse> {
  const endpoint = `${config.apiBaseUrl}/api/desktop/judge-intent`;
  const startedAt = Date.now();
  logger.info('[smart-filtering] calling judge endpoint', {
    requestId,
    endpoint,
    url,
    extractedTextLength: extractedText.length,
  });
  const res = await fetch(endpoint, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      'X-Talysman-Judge-Request-Id': requestId,
    },
    body: JSON.stringify({ url, extractedText, intent }),
    signal: AbortSignal.timeout(JUDGE_FETCH_TIMEOUT_MS),
  });
  logger.info('[smart-filtering] judge endpoint responded', {
    requestId,
    status: res.status,
    elapsedMs: Date.now() - startedAt,
  });
  if (!res.ok) {
    const errorBody = await res.text();
    throw new Error(`judge-intent request failed: ${res.status} ${errorBody.slice(0, 300)}`);
  }
  const body = (await res.json()) as Partial<JudgeIntentResponse>;
  if (typeof body.relevant !== 'boolean' || typeof body.reason !== 'string') {
    throw new Error('judge-intent response missing relevant/reason');
  }
  return { relevant: body.relevant, reason: body.reason };
}

/**
 * Subscribe to the daemon's smart-filtering judge requests. Call once at startup alongside
 * `createTray` / `registerIpcHandlers` (see index.ts).
 */
export function initSmartFiltering(service: ServiceConnection): void {
  logger.info('[smart-filtering] judge listener initialized', {
    apiBaseUrl: config.apiBaseUrl,
  });
  service.on('judgeRequested', ({ requestId, url, extractedText, intent }) => {
    logger.info('[smart-filtering] judgeRequested received', {
      requestId,
      url,
      extractedTextLength: extractedText.length,
    });
    void handleJudgeRequested(service, requestId, url, extractedText, intent);
  });
}

async function handleJudgeRequested(
  service: ServiceConnection,
  requestId: string,
  url: string,
  extractedText: string,
  intent: PolicyIntent,
): Promise<void> {
  const token = await getAccessToken();
  if (!token) {
    logger.warn(`[smart-filtering] skipping judgeRequested ${requestId}: no auth session`);
    return;
  }

  let verdict: JudgeIntentResponse;
  try {
    verdict = await callJudgeEndpoint(requestId, token, url, extractedText, intent);
  } catch (e) {
    // Expected occasionally (network blips, endpoint timeouts). Never retried, never surfaced to
    // the user — the daemon's timeout sweep produces the fallback verdict.
    logger.warn(`[smart-filtering] judge-intent call failed for ${requestId}: ${(e as Error).message}`);
    return;
  }

  logger.info('[smart-filtering] submitting judge verdict', {
    requestId,
    relevant: verdict.relevant,
    reason: verdict.reason,
  });

  try {
    await service.request('submitJudgeVerdict', {
      requestId,
      relevant: verdict.relevant,
      reason: verdict.reason,
    });
    logger.info('[smart-filtering] judge verdict accepted by daemon', { requestId });
  } catch (e) {
    logger.warn(`[smart-filtering] submitJudgeVerdict failed for ${requestId}: ${(e as Error).message}`);
  }
}
