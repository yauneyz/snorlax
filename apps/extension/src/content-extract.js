// Lightweight, dependency-free content extraction for Smart filtering.
//
// Injected via chrome.scripting.executeScript({ func: extractPageContent }) from background.js.
// MV3 serializes this function's source (Function.prototype.toString) and runs it standalone in
// the target tab's isolated world, so it must not reference anything outside its own body — no
// module-level constants, no imports, no closures. The InjectionResult[].result returned by
// executeScript carries the object this function returns straight back to background.js, so a
// separate runtime.sendMessage round trip is unnecessary here: this is a synchronous, same-tick
// DOM read with no async work, and executeScript's return value is well-supported for exactly this
// shape across Chrome/Edge/Firefox.
export function extractPageContent() {
  const STRIP_TAGS = new Set(['SCRIPT', 'STYLE', 'NAV', 'HEADER', 'FOOTER', 'ASIDE', 'NOSCRIPT']);
  const MAX_TEXT_LENGTH = 2000;
  // Read well past the cap before trimming so the collapsed/trimmed text isn't short-changed by
  // whitespace that gets squeezed out later.
  const RAW_LENGTH_BUDGET = MAX_TEXT_LENGTH * 3;

  const title = document.title || '';

  const metaDescriptionEl = document.querySelector('meta[name="description"]');
  const description = (metaDescriptionEl && metaDescriptionEl.getAttribute('content')) || '';

  let text = '';
  if (document.body) {
    const parts = [];
    let rawLength = 0;
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, {
      acceptNode(node) {
        // Skip text inside stripped structural elements (nav/header/footer/aside/script/style).
        let ancestor = node.parentElement;
        while (ancestor) {
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

    text = parts.join(' ').replace(/\s+/g, ' ').trim();
    if (text.length > MAX_TEXT_LENGTH) text = text.slice(0, MAX_TEXT_LENGTH);
  }

  return { title, description, text };
}
