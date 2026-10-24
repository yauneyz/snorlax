// The "are you sure?" page: focus is off, but the user asked to be stopped before opening a site
// their default profile blocks (desktop Settings → "Ask before opening blocked websites"). The
// background sends the tab here instead of the site and tells this page what it was headed to and
// what to say. Each choice is carried out by the background, which owns the tab:
//
// - "Yes, continue" lets that site through for a while and loads it;
// - "No, don't continue" goes back (or closes the tab if there's nothing to go back to);
// - "Turn on focus mode instead" asks the service for `enableFocus`, then goes back.
//
// Own file rather than an inline <script> for MV3's extension-page CSP, like blocked.js.
(function () {
  var browserApi = typeof browser !== 'undefined' ? browser : chrome;

  function el(id) {
    return document.getElementById(id);
  }

  function send(message) {
    return new Promise(function (resolve) {
      try {
        browserApi.runtime.sendMessage(message, function (response) {
          resolve(response || null);
        });
      } catch (e) {
        resolve(null);
      }
    });
  }

  var buttons = ['continue', 'cancel', 'focus'].map(el);
  var url = null;

  function busy(on) {
    buttons.forEach(function (button) {
      button.disabled = on;
    });
  }

  function fail(message) {
    busy(false);
    var node = el('confirm-error');
    node.textContent = message;
    node.hidden = false;
  }

  el('continue').addEventListener('click', function () {
    if (!url) return;
    busy(true);
    void send({ type: 'talysman:confirm-continue', url: url });
  });

  el('cancel').addEventListener('click', function () {
    busy(true);
    void send({ type: 'talysman:confirm-cancel' });
  });

  el('focus').addEventListener('click', function () {
    busy(true);
    send({ type: 'talysman:service', method: 'enableFocus', params: { reason: 'confirm page' } }).then(function (response) {
      if (response && response.ok) {
        void send({ type: 'talysman:confirm-cancel' });
      } else if (response && response.code === 'NO_PAIRED_KEY') {
        fail('Pair a USB key in the Talysman app before turning on focus mode.');
      } else {
        fail((response && response.message) || 'Couldn’t reach the Talysman app.');
      }
    });
  });

  busy(true);
  send({ type: 'talysman:confirm-context' }).then(function (context) {
    url = context && context.url;
    if (context && context.message) el('confirm-title').textContent = context.message;
    if (url) {
      var host = '';
      try {
        host = new URL(url).hostname.replace(/^www\./, '');
      } catch (e) {
        /* Leave the generic summary. */
      }
      if (host) el('confirm-summary').textContent = host + ' is on your blocklist. Focus mode is off, so it’s up to you.';
      busy(false);
    } else {
      // Nothing to continue to (e.g. the page was reloaded after the browser restarted).
      busy(false);
      el('continue').disabled = true;
    }
  });
})();
