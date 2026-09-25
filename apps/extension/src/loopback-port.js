// Firefox for Android has no native messaging, so the Talysman Android app serves the same frames
// as the desktop native host on a loopback socket (apps/android/blocker/.../BridgeServer.kt).
// `loopbackPort` wraps that socket in the subset of the runtime.Port interface background.js
// uses, so the rest of the worker can't tell the transports apart. The Android app only accepts
// a `hello` carrying the pairing code shown in its settings.

export const LOOPBACK_URL = 'ws://127.0.0.1:47623';

/** Is this Firefox for Android (no `connectNative`)? */
export function isAndroidBrowser() {
  return typeof navigator !== 'undefined' && /Android/i.test(navigator.userAgent || '');
}

/**
 * @param {string} pairingCode
 * @returns {{ postMessage(msg: any): void, onMessage: { addListener(cb: (msg: any) => void): void },
 *   onDisconnect: { addListener(cb: () => void): void }, disconnect(): void }}
 */
export function loopbackPort(pairingCode) {
  const messageListeners = [];
  const disconnectListeners = [];
  const queue = [];
  let open = false;
  let closed = false;
  const socket = new WebSocket(LOOPBACK_URL);

  function fireDisconnect() {
    if (closed) return;
    closed = true;
    for (const cb of disconnectListeners) cb();
  }

  socket.onopen = () => {
    open = true;
    for (const frame of queue.splice(0)) socket.send(JSON.stringify(frame));
  };
  socket.onmessage = (event) => {
    let msg;
    try {
      msg = JSON.parse(event.data);
    } catch {
      return;
    }
    for (const cb of messageListeners) cb(msg);
  };
  socket.onclose = fireDisconnect;
  socket.onerror = () => {
    try {
      socket.close();
    } catch {
      /* already closing */
    }
    fireDisconnect();
  };

  return {
    postMessage(msg) {
      if (closed) throw new Error('Talysman app disconnected');
      const frame = msg && msg.type === 'hello' ? { ...msg, pairingCode } : msg;
      if (open) socket.send(JSON.stringify(frame));
      else queue.push(frame);
    },
    onMessage: { addListener: (cb) => messageListeners.push(cb) },
    onDisconnect: { addListener: (cb) => disconnectListeners.push(cb) },
    disconnect: () => socket.close(),
  };
}
