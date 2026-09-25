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
