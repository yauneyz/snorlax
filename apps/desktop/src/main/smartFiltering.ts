/**
 * Smart filtering (architecture §7 / judge protocol). When a browser-extension page falls through
 * both of a `Policy.intent`-enabled profile's hard lists, the daemon broadcasts `judgeRequested`
 * and waits for `submitJudgeVerdict`. Electron main is the only client with the user's Supabase
 * session, so it is the one that turns the request into a call to the web backend's judge
 * endpoint and reports the verdict back.
 *
 * State: profiles/activeProfileId are cached from `stateChanged` / `profilesChanged` (the same
 * events tray.ts and handlers.ts already rely on) purely so a `judgeRequested` handler doesn't
 * have to round-trip `getState` on every request. `activePolicy()` (the same helper the daemon's
 * own mock uses to derive `ServiceState.policy`) resolves the active profile's policy from that
 * cache.
 *
 * Failure handling is deliberately silent: if `intent` is null (the active profile changed out
 * from under the request), or the web call fails/times out, we simply never call
 * `submitJudgeVerdict`. The daemon's own timeout sweep answers with the fail-closed/fail-open
 * fallback per `Policy.defaultAction` — that backstop is what makes it safe to drop these
 * requests on the floor rather than retry them.
 */

import { activePolicy, type PolicyIntent, type Profile } from '@talysman/shared';
import { config } from './config.js';
import { logger } from './logging.js';
import { getAccessToken } from './auth/supabase.js';
import type { ServiceConnection } from './service/connection.js';

const JUDGE_FETCH_TIMEOUT_MS = 10_000;

interface JudgeIntentResponse {
  relevant: boolean;
  reason: string;
}

async function callJudgeEndpoint(
  token: string,
  url: string,
  extractedText: string,
  intent: PolicyIntent,
): Promise<JudgeIntentResponse> {
  const endpoint = `${config.apiBaseUrl}/api/desktop/judge-intent`;
  const res = await fetch(endpoint, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ url, extractedText, intent }),
    signal: AbortSignal.timeout(JUDGE_FETCH_TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`judge-intent request failed: ${res.status}`);
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
  let profiles: Profile[] = [];
  let activeProfileId = '';

  service.on('stateChanged', ({ state }) => {
    profiles = state.profiles;
    activeProfileId = state.activeProfileId;
  });
  service.on('profilesChanged', (payload) => {
    profiles = payload.profiles;
    activeProfileId = payload.activeProfileId;
  });
  void service
    .request('getState', undefined)
    .then((state) => {
      profiles = state.profiles;
      activeProfileId = state.activeProfileId;
    })
    .catch((error: Error) => {
      logger.warn(`[smart-filtering] initial state fetch failed: ${error.message}`);
    });

  service.on('judgeRequested', ({ requestId, url, extractedText }) => {
    void handleJudgeRequested(service, profiles, activeProfileId, requestId, url, extractedText);
  });
}

async function handleJudgeRequested(
  service: ServiceConnection,
  profiles: Profile[],
  activeProfileId: string,
  requestId: string,
  url: string,
  extractedText: string,
): Promise<void> {
  // The active profile may have changed between the daemon sending the request and us handling
  // it (e.g. a schedule window fired, or the user switched profiles). If the profile we'd judge
  // against no longer has Smart filtering on, skip — the daemon's timeout sweep resolves it.
  const intent = activePolicy(profiles, activeProfileId).intent;
  if (!intent) {
    logger.debug(`[smart-filtering] skipping judgeRequested ${requestId}: no active intent`);
    return;
  }

  const token = await getAccessToken();
  if (!token) {
    logger.warn(`[smart-filtering] skipping judgeRequested ${requestId}: no auth session`);
    return;
  }

  let verdict: JudgeIntentResponse;
  try {
    verdict = await callJudgeEndpoint(token, url, extractedText, intent);
  } catch (e) {
    // Expected occasionally (network blips, endpoint timeouts). Never retried, never surfaced to
    // the user — the daemon's timeout sweep produces the fallback verdict.
    logger.warn(`[smart-filtering] judge-intent call failed for ${requestId}: ${(e as Error).message}`);
    return;
  }

  try {
    await service.request('submitJudgeVerdict', {
      requestId,
      url,
      relevant: verdict.relevant,
      reason: verdict.reason,
    });
  } catch (e) {
    logger.warn(`[smart-filtering] submitJudgeVerdict failed for ${requestId}: ${(e as Error).message}`);
  }
}
