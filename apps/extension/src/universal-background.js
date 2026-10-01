// Transport/cache for universal discovery. No catalog dependency; caller supplies policy eligibility.
export function universalEligible(policy, decision) {
  return Boolean(policy.active && policy.universalSoftBlock && decision.layer === 'default' && decision.action === 'allow');
}

export function createUniversalClassifier({ api, eligible, sendNative }) {
  // DEBUG(universal): temporary instrumentation.
  const debug = (...args) => console.info('[talysman:universal]', ...args);
  const pending = new Map();
  const flights = new Map();
  const cache = new Map();
  let generation = 0;
  let cacheWrite = null;
  const ready = api.storage.local.get('universalRulesV1').then((stored) => {
    for (const [key, value] of Object.entries(stored.universalRulesV1 || {}).slice(-256)) {
      if (value?.expires > Date.now() && Array.isArray(value.regions) && value.regions.length <= 80
        && value.regions.every((id) => Number.isInteger(id) && id >= 0 && id < 120)) cache.set(key, value);
    }
  }).catch(() => {});

  function persist() {
    if (cacheWrite !== null) return;
    cacheWrite = setTimeout(() => {
      cacheWrite = null;
      void api.storage.local.set({ universalRulesV1: Object.fromEntries(cache) }).catch(() => {});
    }, 500);
  }

  function finish(id, result) {
    const request = pending.get(id);
    if (!request) return;
    pending.delete(id);
    clearTimeout(request.timer);
    request.resolve(result);
  }

  return {
    invalidate() {
      generation++;
      for (const id of pending.keys()) finish(id, null);
      flights.clear();
    },
    result(message) {
      const request = pending.get(message.requestId);
      if (!request) return false;
      debug('native result', message);
      const regions = message.regions;
      if (request.generation !== generation || !Array.isArray(regions) || regions.length > 80
        || regions.some((id) => !Number.isInteger(id) || !request.ids.has(id))) {
        finish(message.requestId, null);
        return true;
      }
      const value = { regions: [...new Set(regions)], expires: Date.now() + (regions.length ? 7 * 86400_000 : 3600_000) };
      cache.delete(request.key);
      cache.set(request.key, value);
      while (cache.size > 256) cache.delete(cache.keys().next().value);
      persist();
      finish(message.requestId, { regions: value.regions });
      return true;
    },
    async classify(message, sender) {
      const url = sender.url;
      debug('classify request', { frameId: sender.frameId, tab: Boolean(sender.tab), senderUrl: url, messageUrl: message.url, eligible: Boolean(url && eligible(url)), chars: message.content?.length });
      if (sender.frameId !== 0 || !sender.tab || !url || message.url !== url || !eligible(url)) return { disabled: true };
      if (typeof message.content !== 'string' || message.content.length > 24000 || url.length > 4096) return null;
      let summary;
      try { summary = JSON.parse(message.content); } catch { return null; }
      if (!Array.isArray(summary.regions) || summary.regions.length > 120) return null;
      const ids = new Set(summary.regions.map((region) => region.id));
      if ([...ids].some((id) => !Number.isInteger(id) || id < 0 || id >= 120)) return null;
      const started = generation;
      // Origin separates sites. The exact bounded structural summary separates layout variants,
      // with article IDs/URLs excluded so identical templates can reuse a result across pages.
      const bytes = new TextEncoder().encode(`v1:${new URL(url).origin}:${message.content}`);
      const digest = await crypto.subtle.digest('SHA-256', bytes);
      const key = [...new Uint8Array(digest)].map((v) => v.toString(16).padStart(2, '0')).join('');
      await ready;
      if (started !== generation || !eligible(url)) return { disabled: true };
      const hit = cache.get(key);
      if (hit?.expires > Date.now()) { debug('cache hit', hit.regions); return { regions: hit.regions }; }
      if (flights.has(key)) return flights.get(key);
      if (pending.size >= 4) { debug('dropped: 4 requests pending'); return null; }
      const requestId = `universal-${crypto.randomUUID()}`;
      const result = new Promise((resolve) => {
        const timer = setTimeout(() => finish(requestId, null), 30_000);
        pending.set(requestId, { resolve, timer, key, ids, generation });
        try {
          const sent = sendNative({ type: 'judge-request', purpose: 'universal', requestId, url, title: '', content: message.content });
          debug('sent to native', requestId, { sent });
          if (!sent) finish(requestId, null);
        } catch (error) { debug('sendNative threw', String(error)); finish(requestId, null); }
      });
      flights.set(key, result);
      try { return await result; }
      finally { if (flights.get(key) === result) flights.delete(key); }
    },
  };
}
