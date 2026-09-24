// Renders the blocked page from the decision the background (or a DNR redirect) encoded in the
// query string: `layer` (blocklist | allowlist | default | judge) and `reason` from the AI judge.
// Site rules never lead here — they hide parts of a page instead of blocking it.
//
// This lives in its own file rather than an inline <script> in blocked.html because MV3's default
// extension-page CSP (`script-src 'self'`) does not permit 'unsafe-inline'.
(function () {
  var params = new URLSearchParams(window.location.search);

  function show(id, text) {
    var el = document.getElementById(id);
    if (!el) return null;
    if (text !== undefined) el.textContent = text;
    el.hidden = false;
    return el;
  }

  if (params.get('layer') === 'judge') {
    show('blocked-title', 'Not part of your tasks');
    show('blocked-summary', 'Talysman’s AI filter blocked this page based on the tasks you’re working on.');
  }
  var reason = params.get('reason');
  if (reason) show('reason-detail', 'Reason: ' + reason);
})();
