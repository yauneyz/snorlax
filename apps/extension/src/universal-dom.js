// Pure DOM learning helpers. Intentionally imports no catalog or site engine.
const UNIVERSAL_REGION_LIMIT = 120;
const UNIVERSAL_CONTENT_LIMIT = 24000;
const UNIVERSAL_SCAN_LIMIT = 6000;
const UNIVERSAL_SKIP = 'script, style, noscript, svg, template, head, iframe, canvas, img, picture, video, audio, link, meta, br, hr';
// Chrome the user navigates with. Feeds and rails are never inside these.
const UNIVERSAL_CHROME = 'nav, header, [role="navigation"], [role="banner"], [role="dialog"], [role="alertdialog"]';
const UNIVERSAL_EDITABLE = 'input:not([type="hidden"]), textarea, select, [contenteditable]:not([contenteditable="false"]), [role="textbox"]';

function universalText(value, limit = 80) {
  return String(value || '').replace(/\s+/g, ' ').trim().slice(0, limit);
}

function universalAttributes(node) {
  const attrs = {};
  for (const name of ['id', 'class', 'role', 'aria-label', 'data-testid', 'data-test-id', 'data-e2e', 'data-module', 'itemprop', 'page-subtype', 'section-identifier']) {
    const value = node.getAttribute(name);
    if (value) attrs[name] = universalText(value, name === 'class' ? 80 : 60);
  }
  return attrs;
}

/** Stable identity for rebinding a learned region after re-renders: shape of the node and its parents. */
function universalSignature(node) {
  const parts = [];
  for (let current = node, depth = 0; current && current.localName !== 'body' && depth < 4; depth++, current = current.parentElement) {
    parts.push([current.localName, current.getAttribute('id') || '', current.getAttribute('role') || '',
      current.getAttribute('data-testid') || '', current.getAttribute('aria-label') || '']);
  }
  return JSON.stringify(parts);
}

function universalShapeKey(node) {
  return `${node.localName}|${node.getAttribute('id') || ''}|${node.getAttribute('class') || ''}|${node.getAttribute('data-testid') || ''}|${node.getAttribute('role') || ''}`;
}

function universalMain(doc) {
  return doc.querySelector('main, [role="main"]');
}

/**
 * Guard before every application, including cached results. Hiding the page shell (or anything
 * that contains the main column) would blank the page; navigation chrome stays usable.
 */
export function universalCanHide(node) {
  if (!node?.isConnected || node.matches('html, body')) return false;
  const main = universalMain(node.ownerDocument);
  if (main && node !== main && node.contains(main)) return false;
  if (node.closest(UNIVERSAL_CHROME)) return false;
  // Never yank a field out from under the user mid-typing.
  const active = node.ownerDocument.activeElement;
  if (active && active !== node.ownerDocument.body && node.contains(active) && active.matches(UNIVERSAL_EDITABLE)) return false;
  return true;
}

function universalBucket(count) {
  return count === 0 ? 0 : count === 1 ? 1 : count <= 5 ? 'few' : 'many';
}

function universalLabel(node, doc) {
  const own = node.getAttribute('aria-label');
  if (own) return universalText(own, 60);
  const labelledBy = node.getAttribute('aria-labelledby');
  if (labelledBy) {
    const text = labelledBy.split(/\s+/).map((id) => doc.getElementById(id)?.textContent || '').join(' ');
    if (universalText(text)) return universalText(text, 60);
  }
  return '';
}

/** Largest run of same-shaped children: a list's item count and what one item looks like. */
function universalItems(node) {
  const counts = new Map();
  let inspected = 0;
  for (const child of node.children) {
    if (++inspected > 200) break;
    const key = universalShapeKey(child);
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  let best = null;
  for (const [key, count] of counts) if (count >= 3 && (!best || count > best[1])) best = [key, count];
  return best ? { count: universalBucket(best[1]), tag: best[0].split('|')[0], key: best[0] } : null;
}

function universalDescriptor(node, doc, viewport) {
  const rect = node.getBoundingClientRect();
  const scrollY = doc.defaultView?.scrollY || 0;
  const center = rect.left + rect.width / 2;
  // A region's title sits at its top; a heading deep inside ("Discover more" at the end of a
  // thread) describes a child, not the region.
  const heading = [...node.querySelectorAll('h1, h2, h3, h4, [role="heading"]')].slice(0, 5)
    .find((candidate) => candidate.getBoundingClientRect().top - rect.top < 200);
  const descriptor = {
    tag: node.localName,
    attrs: universalAttributes(node),
    label: universalLabel(node, doc),
    heading: universalText(heading?.textContent, 60),
    // Coarse layout: which column, how wide, how tall. Rounded so scrolling and feed growth
    // don't change the summary (it is the cache key).
    column: rect.width >= viewport.width * 0.6 ? 'full' : center < viewport.width * 0.33 ? 'left' : center > viewport.width * 0.67 ? 'right' : 'center',
    widthPct: Math.round((rect.width / viewport.width) * 10) * 10,
    height: rect.height < 150 ? 'small' : rect.height < 600 ? 'medium' : rect.height < 2000 ? 'large' : 'very-large',
    top: rect.top + scrollY < viewport.height ? 'above-fold' : 'below-fold',
    contains: {
      articles: universalBucket(node.querySelectorAll('article, [role="article"]').length),
      videos: universalBucket(node.querySelectorAll('video').length),
      links: universalBucket(node.querySelectorAll('a[href]').length),
      editor: Boolean(node.querySelector(UNIVERSAL_EDITABLE)),
    },
  };
  const items = universalItems(node);
  if (items) descriptor.items = { count: items.count, tag: items.tag };
  return descriptor;
}

function universalOfferable(node, viewport) {
  if (!/^(div|section|aside|main|ul|ol|article|footer)$/.test(node.localName) && !node.localName.includes('-') && !node.hasAttribute('role')) return false;
  const rect = node.getBoundingClientRect();
  // Tiny pieces (buttons, bylines, action bars) are never what a feed or rail is.
  if (rect.width < 120 || rect.height < 60 || rect.width * rect.height < viewport.width * viewport.height * 0.01) return false;
  return node.children.length >= 2 || node.matches('aside, section, main, [role="feed"], [role="region"], [role="complementary"], [role="main"]');
}

/**
 * Bounded rendered-DOM summary, top-down so the budget goes to containers before their contents.
 * Excludes scripts, input values, page prose, and link targets. Each region names its nearest
 * offered ancestor (`parent`) so the model can pick the highest container.
 * `skip(node)` lets the caller exclude subtrees it already hides.
 */
export function universalSnapshot(doc, skip = () => false) {
  const nodes = [];
  const regions = [];
  if (!doc.body) return { nodes, content: '{"regions":[]}' };
  const view = doc.defaultView;
  const viewport = { width: view?.innerWidth || 1280, height: view?.innerHeight || 800 };
  const url = new URL(doc.URL);
  // Firefox content scripts see the page's URLSearchParams through Xrays; its iterators aren't
  // iterable there, so collect keys with forEach.
  const queryKeys = new Set();
  url.searchParams.forEach((_, key) => queryKeys.add(key));
  const context = {
    // Query values and arbitrary URL slugs are not transmitted. Route words aid disambiguation.
    route: url.pathname.split('/').filter(Boolean).map((part) => /^[a-z_-]{1,24}$/i.test(part) ? part : ':item').slice(0, 6),
    queryKeys: [...queryKeys].slice(0, 8).map((key) => universalText(key, 32)),
    title: universalText(doc.title, 80),
    heading: universalText(doc.querySelector('h1')?.textContent),
    viewport: `${viewport.width}x${viewport.height}`,
  };
  let size = JSON.stringify(context).length + 50;
  const ids = new Map();
  const runs = new Map();
  const runKey = (parent) => {
    if (!runs.has(parent)) runs.set(parent, universalItems(parent)?.key);
    return runs.get(parent);
  };
  // Breadth-first: page columns and rails come before the cards inside them.
  const queue = [...doc.body.children];
  let visited = 0;
  for (let index = 0; index < queue.length && visited < UNIVERSAL_SCAN_LIMIT && nodes.length < UNIVERSAL_REGION_LIMIT; index++) {
    const node = queue[index];
    visited++;
    if (node.matches(UNIVERSAL_SKIP) || node.matches('[hidden], [aria-hidden="true"]') || skip(node)) continue;
    if (node.matches(UNIVERSAL_CHROME)) continue;
    const style = view?.getComputedStyle(node);
    if (style && (style.display === 'none' || style.visibility === 'hidden')) continue;
    // A repeated item (a post in a list) is described once, by its list; never descend into
    // every card, which is where a flat walk spends its whole budget. Two bare sibling columns
    // aren't a list: it takes a run of three.
    const previous = node.previousElementSibling;
    const repeatedItem = Boolean(previous && universalShapeKey(previous) === universalShapeKey(node)
      && runKey(node.parentElement) === universalShapeKey(node));
    if (!repeatedItem && universalOfferable(node, viewport) && universalCanHide(node)) {
      let parent = node.parentElement;
      while (parent && !ids.has(parent)) parent = parent.parentElement;
      const region = { id: nodes.length, ...(parent ? { parent: ids.get(parent) } : {}), ...universalDescriptor(node, doc, viewport) };
      const length = JSON.stringify(region).length + 1;
      if (size + length <= UNIVERSAL_CONTENT_LIMIT) {
        size += length;
        ids.set(node, region.id);
        regions.push(region);
        nodes.push({ node, signature: universalSignature(node) });
      }
    }
    if (!repeatedItem) queue.push(...node.children);
  }
  return { nodes, content: JSON.stringify({ context, regions }) };
}

/**
 * Rebind a learned region after re-renders: the original node while it's attached, otherwise
 * nodes with the same structural signature. Repeated peers (e.g. a picked "Who to follow" cell)
 * share the signature and are hidden together.
 */
export function universalMatchingNodes(entry, doc = entry.node?.ownerDocument) {
  if (entry.node?.isConnected) {
    const peers = entry.node.parentElement?.children || [entry.node];
    return [...peers].filter((node) => (node === entry.node || universalSignature(node) === entry.signature) && universalCanHide(node));
  }
  if (!doc) return [];
  const tag = JSON.parse(entry.signature)[0]?.[0];
  if (!tag) return [];
  return [...doc.getElementsByTagName(tag)].filter((node) => universalSignature(node) === entry.signature && universalCanHide(node));
}
