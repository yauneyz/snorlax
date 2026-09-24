// Runs only on the two supported sites. The background owns policy; this script removes discovery
// links and stops in-page navigation before the site's SPA can swap in another feed or post.
(() => {
  if (globalThis.__talysmanSoftContentLoaded) return;
  globalThis.__talysmanSoftContentLoaded = true;
  const api = globalThis.chrome || globalThis.browser;
  const site = location.hostname === 'news.ycombinator.com' ? 'hackernews'
    : location.hostname === 'reddit.com' || location.hostname.endsWith('.reddit.com') ? 'reddit' : null;
  if (!site) return;
  let enabled = false;
  let observer = null;
  let style = null;
  let queued = false;

  function route(value) {
    try {
      const u = new URL(value, location.href);
      const host = u.hostname.toLowerCase();
      const sameSite = site === 'reddit'
        ? host === 'reddit.com' || host.endsWith('.reddit.com') || host === 'redd.it'
        : host === 'news.ycombinator.com';
      if (!sameSite) return null;
      const path = u.pathname.toLowerCase().replace(/\/+$/, '') || '/';
      if (site === 'hackernews') {
        return path === '/item' && /^\d+$/.test(u.searchParams.get('id') || '')
          ? { kind: 'content', id: u.searchParams.get('id') } : { kind: 'blocked' };
      }
      if (host === 'redd.it') {
        const id = path.match(/^\/([a-z0-9]+)$/)?.[1];
        return id ? { kind: 'content', id } : { kind: 'blocked' };
      }
      if (host === 'chat.reddit.com') return { kind: 'message' };
      const match = path.match(/\/(?:comments|gallery|s)\/([a-z0-9]+)(?:\/|$)/);
      if (match) return { kind: 'content', id: match[1] };
      if (/^\/(?:r\/[^/]+\/)?search$/.test(path) && u.searchParams.get('q')?.trim()) return { kind: 'search' };
      if (path === '/message' || path.startsWith('/message/') || path === '/chat' || path.startsWith('/chat/')) return { kind: 'message' };
      return { kind: 'blocked' };
    } catch { return { kind: 'blocked' }; }
  }

  function mayFollow(target) {
    const from = route(location.href);
    const to = route(target);
    if (!to) return true; // An external source is outside this site's soft block.
    if (to.kind === 'blocked') return false;
    if (to.kind === 'search' || to.kind === 'message') return true;
    if (from?.kind === 'search') return to.kind === 'content' || to.kind === 'search' || to.kind === 'message';
    if (from?.kind === 'message') return to.kind === 'message';
    return from?.kind === 'content' && to.kind === 'content' && from.id === to.id;
  }

  function clean() {
    queued = false;
    if (!enabled) return;
    const current = route(location.href);
    document.documentElement.setAttribute('data-talysman-soft-route', current?.kind || 'blocked');
    if (current?.kind !== 'content' && current?.kind !== 'search' && current?.kind !== 'message') return;
    for (const a of document.querySelectorAll('a[href]')) {
      if (a.dataset.talysmanSoftChecked === a.href) continue;
      a.dataset.talysmanSoftChecked = a.href;
      if (!mayFollow(a.href)) a.setAttribute('data-talysman-soft-hidden', '');
      else a.removeAttribute('data-talysman-soft-hidden');
    }
  }

  function queueClean() {
    if (queued) return;
    queued = true;
    setTimeout(clean, 40);
  }

  function apply(active, sites) {
    enabled = Boolean(active && Array.isArray(sites) && sites.includes(site));
    if (enabled) {
      if (!style) {
        style = document.createElement('style');
        style.textContent = `[data-talysman-soft-hidden] { display: none !important; }
          ${site === 'reddit' ? `reddit-sidebar-nav, [data-talysman-soft-route="content"] shreddit-feed, [data-talysman-soft-route="content"] aside, [data-testid*="recommend"], [data-testid*="related"], [data-testid*="trending"] { display: none !important; }` : `#hnmain > tbody > tr:first-child, .pagetop, .morelink { display: none !important; }`}`;
        (document.head || document.documentElement).appendChild(style);
      }
      if (!observer) {
        observer = new MutationObserver(queueClean);
        observer.observe(document.documentElement, { childList: true, subtree: true, attributes: true, attributeFilter: ['href'] });
      }
      queueClean();
    } else {
      observer?.disconnect();
      observer = null;
      style?.remove();
      style = null;
      document.documentElement.removeAttribute('data-talysman-soft-route');
      document.querySelectorAll('[data-talysman-soft-checked]').forEach((a) => {
        a.removeAttribute('data-talysman-soft-hidden');
        a.removeAttribute('data-talysman-soft-checked');
      });
    }
  }

  document.addEventListener('click', (event) => {
    if (!enabled) return;
    const anchor = event.target?.closest?.('a[href]');
    if (!anchor || mayFollow(anchor.href)) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    api.runtime.sendMessage({ type: 'talysman:soft-denied' });
  }, true);

  api.runtime.onMessage.addListener((message) => {
    if (message?.type === 'talysman:soft-policy-updated') apply(message.active, message.sites);
  });
  api.runtime.sendMessage({ type: 'talysman:soft-policy' }, (policy) => {
    if (api.runtime.lastError) return;
    apply(policy?.active, policy?.sites);
  });
})();
