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
