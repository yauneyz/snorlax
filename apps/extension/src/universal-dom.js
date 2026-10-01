// Pure DOM learning helpers. Intentionally imports no catalog or site engine.
const UNIVERSAL_REGION_LIMIT = 120;
const UNIVERSAL_CONTENT_LIMIT = 24000;
const UNIVERSAL_SCAN_LIMIT = 5000;
const UNIVERSAL_PROTECTED = 'input, textarea, select, [contenteditable]:not([contenteditable="false"]), form, video, audio, [role="search"], [role="textbox"], [itemprop="articleBody"]';
const UNIVERSAL_SKIP = 'script, style, noscript, svg, template, head';

function universalText(value, limit = 80) {
  return String(value || '').replace(/\s+/g, ' ').trim().slice(0, limit);
}

function universalAttributes(node) {
  const attrs = {};
  for (const name of ['id', 'class', 'role', 'aria-label', 'data-testid', 'data-test', 'data-module', 'itemprop']) {
    const value = node.getAttribute(name);
    if (value) attrs[name] = universalText(value, name === 'class' ? 180 : 80);
  }
  return attrs;
}

function universalShape(node) {
  return { tag: node.localName, attributes: universalAttributes(node) };
}

/** Guard before every application, including cached results. Large article text is kept local. */
export function universalCanHide(node) {
  if (!node?.isConnected || node.matches('html, body, header, nav, [role="navigation"], [role="banner"]')) return false;
  if (node.matches(UNIVERSAL_PROTECTED) || node.querySelector(UNIVERSAL_PROTECTED)) return false;
  if (node.closest('nav, header, [role="navigation"], [role="dialog"], [role="search"], [contenteditable="true"]')) return false;
  // A long article can contain recommendations; protecting the article does not protect its aside.
  if (node.matches('article, main, [role="main"]') || node.querySelector('article')) {
    const paragraphs = node.querySelectorAll('p');
    let length = 0;
    for (const p of paragraphs) {
      length += p.textContent?.length || 0;
      if (length > 600) return false;
    }
  }
  return true;
}

function universalDescriptor(node) {
  const children = [];
  const counts = new Map();
  let inspected = 0;
  for (const child of node.children) {
    if (++inspected > 40) break;
    if (child.matches(UNIVERSAL_SKIP)) continue;
    const shape = universalShape(child);
    const key = JSON.stringify(shape);
    const count = counts.get(key) || 0;
    counts.set(key, count + 1);
    if (count < 2 && children.length < 10) children.push(shape);
  }
  // Counts saturate: adding more cards to an established feed doesn't invalidate the template.
  const repeated = [...counts.values()].some((count) => count >= 3);
  const labels = [...node.querySelectorAll(':scope > h1, :scope > h2, :scope > h3, :scope > header, :scope > a, :scope > button')]
    .slice(0, 4).map((child) => universalText(child.textContent, 60));
  const ancestors = [];
  let parent = node.parentElement;
  for (let depth = 0; parent && parent.localName !== 'body' && depth < 3; depth++, parent = parent.parentElement) {
    ancestors.push(universalShape(parent));
  }
  return { ...universalShape(node), ancestors, labels, children, repeated };
}

/** Bounded rendered-DOM summary, with no scripts, input values, page prose, or link query strings. */
export function universalSnapshot(doc) {
  const nodes = [];
  const regions = [];
  if (!doc.body) return { nodes, content: '{"regions":[]}' };
  const walker = doc.createTreeWalker(doc.body, 1 /* SHOW_ELEMENT */);
  let visited = 0;
  const url = new URL(doc.URL);
  const context = {
    // Query values and arbitrary URL slugs are not transmitted. Route words aid disambiguation.
    route: url.pathname.split('/').filter(Boolean).map((part) => /^[a-z_-]{1,24}$/i.test(part) ? part : ':item').slice(0, 6),
    queryKeys: [...new Set(url.searchParams.keys())].slice(0, 8).map((key) => universalText(key, 32)),
    heading: universalText(doc.querySelector('h1')?.textContent),
    hasSearch: Boolean(doc.querySelector('input[type="search"], [role="search"]')),
  };
  let size = JSON.stringify(context).length + 50;
  while (walker.nextNode() && visited++ < UNIVERSAL_SCAN_LIMIT && nodes.length < UNIVERSAL_REGION_LIMIT) {
    const node = walker.currentNode;
    if (node.closest(UNIVERSAL_SKIP) || node.closest('[hidden], [aria-hidden="true"]')) continue;
    if (!/^(div|section|aside|main|ul|ol|article)$/.test(node.localName) && !node.localName.includes('-') && !node.hasAttribute('role')) continue;
    if (node.children.length < 2 && !node.matches('aside, section, [role="feed"]')) continue;
    if (!universalCanHide(node)) continue;
    // Collapse repeated siblings to representatives; local matching applies the same rule to peers.
    const shape = JSON.stringify(universalShape(node));
    if (node.previousElementSibling && JSON.stringify(universalShape(node.previousElementSibling)) === shape) continue;
    const descriptor = universalDescriptor(node);
    const region = { id: nodes.length, ...descriptor };
    const length = JSON.stringify(region).length + 1;
    if (size + length > UNIVERSAL_CONTENT_LIMIT) continue;
    size += length;
    regions.push(region);
    nodes.push({ node, signature: JSON.stringify(descriptor) });
  }
  return { nodes, content: JSON.stringify({ context, regions }) };
}

/** Exact structure checks intentionally fail closed to hiding when a learned target has changed. */
export function universalMatchingNodes(entry) {
  if (!universalCanHide(entry.node) || JSON.stringify(universalDescriptor(entry.node)) !== entry.signature) return [];
  const peers = entry.node.parentElement?.children || [entry.node];
  return [...peers].filter((node) => universalCanHide(node) && JSON.stringify(universalDescriptor(node)) === entry.signature);
}
