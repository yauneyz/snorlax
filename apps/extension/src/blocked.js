// Renders the blocked page from the decision the background (or a DNR redirect) encoded in the
// query string: `layer` (blocklist | allowlist | default | judge) and `reason` from the AI judge.
// Site rules never lead here — they hide parts of a page instead of blocking it.
//
// Below the explanation sits the unlock popup (spec §3.10): which profiles block the page, the
// streak, the page's unlock pool with what's left today, the pause before an unlock, and a link
// to the desktop app's key-gated options. Its data comes from the service through the background
// worker and the native host, which only relay popup info and the keyless pool-unlock commands.
//
// This lives in its own file rather than an inline <script> in blocked.html because MV3's default
// extension-page CSP (`script-src 'self'`) does not permit 'unsafe-inline'.
(function () {
  var browserApi = typeof browser !== 'undefined' ? browser : chrome;
  var params = new URLSearchParams(window.location.search);

  function el(id) {
    return document.getElementById(id);
  }

  function show(id, text) {
    var node = el(id);
    if (!node) return null;
    if (text !== undefined) node.textContent = text;
    node.hidden = false;
    return node;
  }

  function hide(id) {
    var node = el(id);
    if (node) node.hidden = true;
  }

  if (params.get('layer') === 'judge') {
    show('blocked-title', 'Not part of your tasks');
    show('blocked-summary', 'Talysman’s AI filter blocked this page based on the tasks you’re working on.');
  }
  var reason = params.get('reason');
  if (reason) show('reason-detail', 'Reason: ' + reason);

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

  function service(method, serviceParams) {
    return send({ type: 'talysman:service', method: method, params: serviceParams });
  }

  var url = null;
  var info = null;
  var tickTimer = 0;

  function poolRefs() {
    return info.pools.map(function (p) {
      return { profileId: p.profileId, poolId: p.poolId };
    });
  }

  function render() {
    if (!info) return;
    show('unlock');
    var by = el('blocked-by');
    by.textContent = '';
    if (info.blockingProfiles.length) {
      by.appendChild(document.createTextNode('Blocked by'));
      info.blockingProfiles.forEach(function (p) {
        var chip = document.createElement('span');
        chip.className = 'profile-chip';
        var dot = document.createElement('i');
        dot.style.background = p.color;
        chip.appendChild(dot);
        chip.appendChild(document.createTextNode(p.name));
        by.appendChild(chip);
      });
      by.hidden = false;
    }
    var streak = info.streak;
    show('streak', '🔥 ' + streak.currentDays + '-day streak' + (streak.bestDays > streak.currentDays ? ' · best ' + streak.bestDays : ''));

    var button = el('unlock-button');
    if (!info.pools.length) {
      show('pool');
      show('pool-title', 'This page isn’t in an unlock pool.');
      show('pool-detail', 'Change that, or turn blocking off, in the Talysman app.');
      button.hidden = true;
    } else {
      var left = Math.min.apply(null, info.pools.map(function (p) { return p.leftToday; }));
      var perDay = Math.min.apply(null, info.pools.map(function (p) { return p.unlocksPerDay; }));
      var minutes = Math.max.apply(null, info.pools.map(function (p) { return p.unlockMinutes; }));
      show('pool');
      show('pool-title', info.pools.map(function (p) { return p.name; }).join(' + ') + ' · ' + left + ' of ' + perDay + ' unlocks left today');
      var detail = 'Each unlock: ' + minutes + ' minutes.';
      if (info.unpooledProfiles.length) detail += ' Another profile blocks this with no unlocks.';
      else if (left === 0) detail += ' Resets at midnight.';
      show('pool-detail', detail);

      var pending = info.pending;
      var remaining = pending ? Math.max(0, Math.ceil((pending.readyMs - Date.now()) / 1000)) : 0;
      if (pending && remaining > 0) {
        show('pause');
        var ring = el('pause-ring');
        ring.textContent = String(remaining);
        ring.classList.toggle('breathing', info.friction.kind === 'breathing');
        show('pause-text', info.friction.kind === 'breathing' ? 'Breathe in… and out.' : 'Take a moment.');
      } else {
        hide('pause');
      }
      button.hidden = !info.unlockAvailable;
      button.disabled = Boolean(pending && remaining > 0);
      button.textContent = pending && remaining > 0 ? 'Unlock in ' + remaining + ' s' : 'Unlock for ' + minutes + ' min';
      if (pending && remaining > 0 && !tickTimer) {
        tickTimer = window.setInterval(function () {
          render();
          if (!info.pending || info.pending.readyMs <= Date.now()) {
            window.clearInterval(tickTimer);
            tickTimer = 0;
            render();
          }
        }, 250);
      }
    }
    el('other-options').textContent = 'Other options (' + info.emergencyLeft + ' emergency unlocks left)';
  }

  function refresh() {
    return service('getPopupInfo', { target: { kind: 'url', url: url } }).then(function (response) {
      if (response && response.ok) {
        info = response.result;
        render();
      }
      return response;
    });
  }

  /** After an unlock, go back once the extension has the policy that lets the page through. */
  function returnWhenAllowed(attempts) {
    send({ type: 'talysman:blocked-context' }).then(function (context) {
      if (context && context.decision && context.decision.action !== 'block') {
        window.location.replace(url);
      } else if (attempts > 0) {
        window.setTimeout(function () { returnWhenAllowed(attempts - 1); }, 300);
      } else {
        window.location.replace(url);
      }
    });
  }

  el('unlock-button').addEventListener('click', function () {
    if (!info) return;
    hide('unlock-error');
    var type = info.pending ? 'confirmPoolUnlock' : 'requestPoolUnlock';
    service('applyCommand', { command: { type: type, pools: poolRefs() } }).then(function (response) {
      if (!response || !response.ok) {
        show('unlock-error', (response && response.message) || 'Unlock failed.');
        return;
      }
      refresh().then(function () {
        var unlocked = info && info.pools.some(function (p) {
          return p.activeUntilMs !== null && p.activeUntilMs > Date.now();
        });
        if (unlocked) returnWhenAllowed(15);
      });
    });
  });

  send({ type: 'talysman:blocked-context' }).then(function (context) {
    url = context && context.url;
    if (url) void refresh();
  });
})();
