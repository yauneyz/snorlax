// Shows the optional `reason` query param on the blocked page — set when Smart filtering's
// judge redirected the tab here (see background.js), or when the client-side judge timeout fell
// back to `defaultAction: 'block'`.
//
// This lives in its own file rather than an inline <script> in blocked.html because MV3's default
// extension-page CSP (`script-src 'self'`) does not permit 'unsafe-inline' and would silently
// block a literal inline <script> block; an extension-bundled file is unaffected.
(function () {
  var params = new URLSearchParams(window.location.search);
  var reason = params.get('reason');
  if (!reason) return;

  var el = document.getElementById('reason-detail');
  if (!el) return;

  el.textContent = 'Reason: ' + reason;
  el.hidden = false;
})();
