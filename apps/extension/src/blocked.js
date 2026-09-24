// Renders the blocked page from the decision the background (or a DNR redirect) encoded in the
// query string: `layer` (blocklist | site | allowlist | default | judge), `site`/`feature` for
// site rules, `hop` when the user jumped between items, and `reason` from the AI judge. For site
// rules it offers the site's catalog entry points (search, messages, …) whose features the user
// still allows.
//
// This lives in its own file rather than an inline <script> in blocked.html because MV3's default
// extension-page CSP (`script-src 'self'`) does not permit 'unsafe-inline'. blocked.html loads the
// generated site-catalog.js first, which defines `SITE_CATALOG`.
/* global SITE_CATALOG */
(function () {
  var params = new URLSearchParams(window.location.search);
  var api = globalThis.chrome || globalThis.browser;
  var site = SITE_CATALOG[params.get('site')] || null;
  var featureId = params.get('feature');
  var feature = site ? site.features.find(function (f) { return f.id === featureId; }) : null;
  var layer = params.get('layer') || (site ? 'site' : 'blocklist');

  function show(id, text) {
    var el = document.getElementById(id);
    if (!el) return null;
    if (text !== undefined) el.textContent = text;
    el.hidden = false;
    return el;
  }

  if (site) {
    show('blocked-title', site.label + ' is limited right now');
    if (params.get('hop')) {
      show('blocked-summary', 'Moving from one ' + site.label + ' item to another is blocked by your site rules (' + (feature ? feature.label : 'recommendations') + ').');
    } else {
      show('blocked-summary', (feature ? feature.label : 'This part of ' + site.label) + ' is blocked by your site rules.');
    }
  }
  if (layer === 'judge') {
    show('blocked-title', 'Not part of your tasks');
    show('blocked-summary', 'Talysman’s AI filter blocked this page based on the tasks you’re working on.');
  }
  var reason = params.get('reason');
  if (reason) show('reason-detail', 'Reason: ' + reason);

  if (!site || site.entryPoints.length === 0) return;

  function render(features) {
    var entries = site.entryPoints.filter(function (entry) {
      return !features || features[entry.feature] !== 'block';
    });
    var search = entries.find(function (entry) { return entry.param; });
    if (search) {
      var form = document.getElementById('site-search');
      var input = document.getElementById('site-query');
      form.action = search.url;
      input.name = search.param;
      document.getElementById('site-search-label').textContent = search.label;
      form.hidden = false;
    }
    var tools = document.getElementById('site-tools');
    tools.textContent = '';
    entries.filter(function (entry) { return !entry.param; }).forEach(function (entry) {
      var link = document.createElement('a');
      link.href = entry.url;
      link.textContent = entry.label;
      tools.appendChild(link);
    });
    tools.hidden = tools.childElementCount === 0;
  }

  // Ask the worker which features are allowed so only usable shortcuts are offered.
  try {
    api.runtime.sendMessage({ type: 'talysman:site-policy' }, function (policy) {
      var rule = !api.runtime.lastError && policy && policy.sites ? policy.sites[site.id] : null;
      render(rule ? rule.features : null);
    });
  } catch (e) {
    render(null);
  }
})();
