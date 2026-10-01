import { getStatusView } from './popup-view.js';

const browserApi = globalThis.chrome || globalThis.browser;
const statusCard = document.querySelector('.status-card');
const title = document.querySelector('#status-title');
const detail = document.querySelector('#status-detail');
const connectionValue = document.querySelector('#connection-value');
const focusValue = document.querySelector('#focus-value');
const version = document.querySelector('#version');

const manifestVersion = browserApi.runtime.getManifest().version;
version.textContent = manifestVersion ? `Extension ${manifestVersion}` : 'Extension';

function setView({ tone, heading, description, connection, focus }) {
  statusCard.dataset.tone = tone;
  title.textContent = heading;
  detail.textContent = description;
  connectionValue.textContent = connection;
  focusValue.textContent = focus;
}

function render(status) {
  setView(getStatusView(status));
}

function refresh() {
  browserApi.runtime.sendMessage({ type: 'talysman:get-status' }, (response) => {
    if (browserApi.runtime.lastError) {
      render(null);
      return;
    }
    render(response);
  });
}

refresh();
setInterval(refresh, 1000);

// Firefox for Android talks to the Talysman app over a paired loopback connection.
const pairing = document.querySelector('#pairing');
const pairingInput = document.querySelector('#pairing-code');
if (/Android/i.test(navigator.userAgent) && browserApi.storage && browserApi.storage.local) {
  pairing.hidden = false;
  browserApi.storage.local.get('androidPairingCode', (items) => {
    pairingInput.value = (items && items.androidPairingCode) || '';
  });
  pairing.addEventListener('submit', (event) => {
    event.preventDefault();
    const code = pairingInput.value.trim().toUpperCase();
    browserApi.storage.local.set({ androidPairingCode: code || null });
  });
}

// Unlock group: spend one of the active page's temporary unlocks, exactly as the blocked page does
// (`requestPoolUnlock`, then `confirmPoolUnlock` once any pause before an unlock has run out).
const unlockCard = document.querySelector('#unlock');
const unlockTitle = document.querySelector('#unlock-title');
const unlockDetail = document.querySelector('#unlock-detail');
const unlockButton = document.querySelector('#unlock-button');
const unlockError = document.querySelector('#unlock-error');
let unlockTarget = null;
let unlockInfo = null;

function sendMessage(message) {
  return new Promise((resolve) => {
    try {
      browserApi.runtime.sendMessage(message, (response) => {
        resolve(browserApi.runtime.lastError ? null : response || null);
      });
    } catch {
      resolve(null);
    }
  });
}

function service(method, params) {
  return sendMessage({ type: 'talysman:service', method, params });
}

function renderUnlock() {
  const info = unlockInfo;
  if (!info || !info.blockingProfiles.length) {
    unlockCard.hidden = true;
    return;
  }
  unlockCard.hidden = false;
  if (!info.pools.length) {
    unlockTitle.textContent = `${info.label} isn’t in an unlock group.`;
    unlockDetail.textContent = 'Change that, or turn blocking off, in the Talysman app.';
    unlockButton.hidden = true;
    return;
  }
  const left = Math.min(...info.pools.map((p) => p.leftToday));
  const perDay = Math.min(...info.pools.map((p) => p.unlocksPerDay));
  const minutes = Math.max(...info.pools.map((p) => p.unlockMinutes));
  unlockTitle.textContent = `${info.pools.map((p) => p.name).join(' + ')} · ${left} of ${perDay} unlocks left today`;
  let detail = `Each unlock: ${minutes} minutes.`;
  if (info.unpooledProfiles.length) detail += ' Another profile blocks this with no unlocks.';
  else if (left === 0) detail += ' Resets at midnight.';
  unlockDetail.textContent = detail;

  const remaining = info.pending ? Math.max(0, Math.ceil((info.pending.readyMs - Date.now()) / 1000)) : 0;
  unlockButton.hidden = !info.unlockAvailable;
  unlockButton.disabled = remaining > 0;
  unlockButton.textContent = remaining > 0 ? `Unlock in ${remaining} s` : `Unlock ${info.label} for ${minutes} min`;
}

async function refreshUnlock() {
  if (!unlockTarget) return;
  const response = await service('getPopupInfo', { target: { kind: 'url', url: unlockTarget.url } });
  unlockInfo = response && response.ok ? response.result : null;
  renderUnlock();
}

unlockButton.addEventListener('click', async () => {
  if (!unlockInfo || !unlockTarget) return;
  unlockError.hidden = true;
  const type = unlockInfo.pending ? 'confirmPoolUnlock' : 'requestPoolUnlock';
  const pools = unlockInfo.pools.map((p) => ({ profileId: p.profileId, poolId: p.poolId }));
  const response = await service('applyCommand', { command: { type, pools } });
  if (!response || !response.ok) {
    unlockError.textContent = (response && response.message) || 'Unlock failed.';
    unlockError.hidden = false;
    return;
  }
  await refreshUnlock();
  // A blocked tab goes back to its page; the blocked page's own retry covers a slow policy push.
  const unlocked = !unlockInfo
    || !unlockInfo.blockingProfiles.length
    || unlockInfo.pools.some((p) => p.activeUntilMs !== null && p.activeUntilMs > Date.now());
  if (unlocked && unlockTarget.blocked) {
    browserApi.tabs.update(unlockTarget.tabId, { url: unlockTarget.url });
    window.close();
  }
});

sendMessage({ type: 'talysman:active-tab' }).then((target) => {
  unlockTarget = target;
  void refreshUnlock();
});
// Ticks the pause countdown; the pending unlock itself lives in the service, so reopening resumes it.
setInterval(renderUnlock, 250);
