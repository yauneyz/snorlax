// Lightweight, dependency-free content extraction for the AI judge.
//
// Injected via chrome.scripting.executeScript({ func: extractPageContent, args: [selector] }) from
// background.js. MV3 serializes this function's source (Function.prototype.toString) and runs it
// standalone in the target tab's isolated world, so it must not reference anything outside its own
// body — no module-level constants, no imports, no closures. The InjectionResult[].result returned
// by executeScript carries the object this function returns straight back to background.js.
//
// `contentSelector` comes from the site catalog's route hint (e.g. a Reddit post body). When it
// matches, only that content is read, so the judge sees the post rather than the site's chrome.
export function extractPageContent(contentSelector) {
  const STRIP_TAGS = new Set(['SCRIPT', 'STYLE', 'NAV', 'HEADER', 'FOOTER', 'ASIDE', 'NOSCRIPT']);
  const MAX_TEXT_LENGTH = 4000;
  const MAX_HEADINGS_LENGTH = 500;
  // Read well past the cap before trimming so the collapsed/trimmed text isn't short-changed by
  // whitespace that gets squeezed out later.
  const RAW_LENGTH_BUDGET = MAX_TEXT_LENGTH * 3;

  const title = document.title || '';

  const metaDescriptionEl = document.querySelector('meta[name="description"], meta[property="og:description"]');
  const description = (metaDescriptionEl && metaDescriptionEl.getAttribute('content')) || '';

  let roots = [];
  if (contentSelector) {
    try {
      roots = Array.from(document.querySelectorAll(contentSelector));
    } catch {
      roots = [];
    }
  }
  if (roots.length === 0 && document.body) roots = [document.body];

  const headings = roots
    .flatMap((root) => Array.from(root.querySelectorAll('h1, h2, h3')))
    .map((el) => (el.textContent || '').replace(/\s+/g, ' ').trim())
    .filter(Boolean)
    .join(' · ')
    .slice(0, MAX_HEADINGS_LENGTH);

  const parts = [];
  let rawLength = 0;
  for (const root of roots) {
    if (rawLength >= RAW_LENGTH_BUDGET) break;
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
      acceptNode(node) {
        // Skip text inside stripped structural elements (nav/header/footer/aside/script/style),
        // but only below the chosen root — a selected post may itself sit inside a <main>.
        let ancestor = node.parentElement;
        while (ancestor && ancestor !== root.parentElement) {
          if (STRIP_TAGS.has(ancestor.tagName)) return NodeFilter.FILTER_REJECT;
          ancestor = ancestor.parentElement;
        }
        // Skip text that isn't actually visible on the page.
        const parent = node.parentElement;
        if (parent) {
          const style = window.getComputedStyle(parent);
          if (style && (style.display === 'none' || style.visibility === 'hidden')) {
            return NodeFilter.FILTER_REJECT;
          }
        }
        return NodeFilter.FILTER_ACCEPT;
      },
    });
    let node = walker.nextNode();
    while (node) {
      const value = node.nodeValue;
      if (value) {
        parts.push(value);
        rawLength += value.length;
        if (rawLength >= RAW_LENGTH_BUDGET) break;
      }
      node = walker.nextNode();
    }
  }

  let text = parts.join(' ').replace(/\s+/g, ' ').trim();
  if (text.length > MAX_TEXT_LENGTH) text = text.slice(0, MAX_TEXT_LENGTH);

  return { title, description, headings, text };
}
