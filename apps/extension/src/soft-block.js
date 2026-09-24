// Deliberately small allowlist. Unknown URLs stay closed until an adapter is reviewed.
export const SOFT_SITES = {
  reddit: { domain: 'reddit.com', hosts: ['reddit.com'] },
  hackernews: { domain: 'news.ycombinator.com', hosts: ['news.ycombinator.com'] },
};

export function softSiteForUrl(value) {
  try {
    const host = new URL(value).hostname.toLowerCase();
    if (host === 'reddit.com' || host.endsWith('.reddit.com') || host === 'redd.it') return 'reddit';
    if (host === 'news.ycombinator.com') return 'hackernews';
  } catch { /* Browser-internal or invalid URL. */ }
  return null;
}

export function softRoute(value) {
  const site = softSiteForUrl(value);
  if (!site) return null;
  const url = new URL(value);
  const path = url.pathname.toLowerCase().replace(/\/+$/, '') || '/';
  if (site === 'reddit') {
    if (url.hostname === 'redd.it') {
      const id = path.match(/^\/([a-z0-9]+)$/)?.[1];
      return id ? { site, kind: 'content', id } : { site, kind: 'blocked' };
    }
    if (url.hostname === 'chat.reddit.com') return { site, kind: 'message' };
    if (/^\/(?:r\/[^/]+\/)?comments\/[a-z0-9]+(?:\/.*)?$/.test(path)
      || /^\/r\/[^/]+\/s\/[a-z0-9]+$/.test(path)
      || /^\/gallery\/[a-z0-9]+$/.test(path)) {
      const id = path.match(/\/(?:comments|gallery|s)\/([a-z0-9]+)/)?.[1];
      return { site, kind: 'content', id };
    }
    if (/^\/(?:r\/[^/]+\/)?search$/.test(path) && url.searchParams.get('q')?.trim()) {
      return { site, kind: 'search' };
    }
    if (path === '/message' || path.startsWith('/message/') || path === '/chat' || path.startsWith('/chat/')) {
      return { site, kind: 'message' };
    }
  } else if (site === 'hackernews') {
    if (path === '/item' && /^\d+$/.test(url.searchParams.get('id') || '')) {
      return { site, kind: 'content', id: url.searchParams.get('id') };
    }
    // HN's search is hosted by Algolia on another domain; it remains available as an external site.
  }
  return { site, kind: 'blocked' };
}

export function softNavigationAllowed(source, target) {
  const from = softRoute(source);
  const to = softRoute(target);
  if (!to || to.kind === 'blocked') return false;
  if (!from || from.site !== to.site) return true;
  if (new URL(source).hostname === 'redd.it' && to.kind === 'content') return true;
  if (to.kind === 'search' || to.kind === 'message') return true;
  if (from.kind === 'search') return to.kind === 'content' || to.kind === 'search' || to.kind === 'message';
  if (from.kind === 'message') return to.kind === 'message';
  return from.kind === 'content' && to.kind === 'content' && from.id === to.id;
}
