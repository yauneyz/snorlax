/**
 * Real NDJSON-RPC client over the platform IPC endpoint to the privileged service
 * (architecture §6). One line = one message. Auto-reconnects if the service restarts, and
 * re-emits the latest state to subscribers on reconnect.
 *
 * Node's `net.connect({ path })` works for Windows named pipes and Unix-domain sockets.
 */

import net from 'node:net';
import {
  type EventMessage,
  type EventName,
  type EventPayload,
  type Method,
  type Params,
  type Result,
  type RpcRequest,
  type RpcResponse,
} from '@talysman/shared';
import { logger } from '../logging.js';
import { flushEvents, track } from '../analytics.js';
import type { ServiceConnection, ServiceError } from './connection.js';

const RECONNECT_DELAY_MS = 1500;
const RPC_TIMEOUT_MS = 15_000;
/**
 * `connect()` resolves only on success — it never rejects, because a dead service is expected to
 * come back and the reconnect loop keeps trying. The cost is that a service which never arrives
 * leaves the UI on "Connecting…" forever with nothing in the log to say why. Report it once.
 */
const CONNECT_STUCK_MS = 15_000;

interface Pending {
  resolve: (value: unknown) => void;
  reject: (err: ServiceError) => void;
  timeout: NodeJS.Timeout;
}

type Listener = (payload: unknown) => void;

function makeError(code: string, message: string): ServiceError {
  const e = new Error(message) as ServiceError;
  e.code = code;
  return e;
}

export class PipeServiceConnection implements ServiceConnection {
  connected = false;

  private socket: net.Socket | null = null;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private nextId = 1;
  private pending = new Map<number, Pending>();
  private listeners = new Map<EventName, Set<Listener>>();
  private closed = false;
  private connectWaiters: Array<() => void> = [];
  private stuckTimer: NodeJS.Timeout | null = null;

  constructor(private readonly pipePath: string) {}

  connect(): Promise<void> {
    this.closed = false;
    this.open();
    if (this.connected) return Promise.resolve();
    if (this.stuckTimer === null) {
      this.stuckTimer = setTimeout(() => {
        this.stuckTimer = null;
        if (!this.connected) {
          logger.error(
            `[service] still not connected to ${this.pipePath} after ${CONNECT_STUCK_MS}ms; ` +
              'the UI stays on "Connecting…" until this succeeds. Check that the privileged ' +
              'service is running and that the endpoint exists.',
          );
        }
      }, CONNECT_STUCK_MS);
      this.stuckTimer.unref?.();
    }
    return new Promise((resolve) => this.connectWaiters.push(resolve));
  }

  private clearStuckTimer(): void {
    if (this.stuckTimer !== null) {
      clearTimeout(this.stuckTimer);
      this.stuckTimer = null;
    }
  }

  private open(): void {
    // A socket object represents both an in-progress connect and a live connection. Keeping one
    // here prevents repeated connect() calls and reconnect timers from opening parallel pipes.
    if (this.closed || this.socket) return;
    const socket = net.connect({ path: this.pipePath });
    this.socket = socket;
    let buffer = '';

    socket.setEncoding('utf8');

    socket.on('connect', () => {
      if (this.socket !== socket || this.closed) {
        socket.destroy();
        return;
      }
      this.connected = true;
      this.clearStuckTimer();
      logger.info(`[service] connected to ${this.pipePath}`);
      this.connectWaiters.forEach((w) => w());
      this.connectWaiters = [];

      // A connection can miss broadcasts while it is down. Reconcile from the daemon's
      // authoritative snapshot after every connect (the initial one is harmless before UI
      // listeners are registered).
      void this.request('getState', undefined)
        .then((state) => {
          this.listeners.get('stateChanged')?.forEach((cb) => cb({ state }));
        })
        .catch((e: Error) => {
          logger.warn(`[service] state reconciliation failed: ${e.message}`);
        });
    });

    socket.on('data', (chunk: string) => {
      // NDJSON fragments are connection-local. Never carry a partial line across a daemon
      // restart: it could be completed by unrelated bytes from the next socket.
      buffer += chunk;
      let nl: number;
      while ((nl = buffer.indexOf('\n')) !== -1) {
        const line = buffer.slice(0, nl).trim();
        buffer = buffer.slice(nl + 1);
        if (!line) continue;
        try {
          this.dispatch(JSON.parse(line));
        } catch {
          logger.warn(`[service] bad line: ${line}`);
        }
      }
    });

    socket.on('error', (e) => {
      if (this.socket !== socket) return;
      logger.warn(`[service] socket error: ${(e).message}`);
      // Only the case a fresh install can't see: a previously-working connection just broke
      // mid-session. A not-yet-established connect attempt failing is already covered by
      // bootstrap_failed from connectService()'s own throw — tracking every retry here too
      // would just be noise on top of that.
      if (this.connected) {
        track('service_disconnected', { message: e.message });
        void flushEvents();
      }
    });

    socket.on('close', () => {
      if (this.socket !== socket) return;
      this.connected = false;
      this.socket = null;
      this.rejectPending(makeError('DISCONNECTED', 'Service disconnected.'));
      if (!this.closed && this.reconnectTimer === null) {
        this.reconnectTimer = setTimeout(() => {
          this.reconnectTimer = null;
          this.open();
        }, RECONNECT_DELAY_MS);
      }
    });
  }

  private rejectPending(error: ServiceError): void {
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timeout);
      pending.reject(error);
    }
    this.pending.clear();
  }

  private dispatch(msg: RpcResponse | EventMessage): void {
    if (msg.kind === 'response') {
      const pending = this.pending.get(msg.id);
      if (!pending) return;
      this.pending.delete(msg.id);
      clearTimeout(pending.timeout);
      if (msg.ok) pending.resolve(msg.result);
      else pending.reject(makeError(msg.code, msg.message));
    } else if (msg.kind === 'event') {
      this.listeners.get(msg.event)?.forEach((cb) => cb(msg.payload));
    }
  }

  request<M extends Method>(method: M, params: Params<M>): Promise<Result<M>> {
    if (!this.socket || !this.connected) {
      return Promise.reject(makeError('DISCONNECTED', 'Service not connected.'));
    }
    const id = this.nextId++;
    const req: RpcRequest<M> = { kind: 'request', id, method, params };
    return new Promise<Result<M>>((resolve, reject) => {
      const socket = this.socket!;
      const timeout = setTimeout(() => {
        if (!this.pending.delete(id)) return;
        reject(makeError('TIMEOUT', `Service request ${method} timed out.`));
      }, RPC_TIMEOUT_MS);
      this.pending.set(id, { resolve: resolve as (v: unknown) => void, reject, timeout });
      socket.write(`${JSON.stringify(req)}\n`, (e) => {
        if (e) {
          const pending = this.pending.get(id);
          if (!pending) return;
          this.pending.delete(id);
          clearTimeout(pending.timeout);
          reject(makeError('WRITE_FAILED', e.message));
        }
      });
    });
  }

  on<E extends EventName>(event: E, cb: (payload: EventPayload<E>) => void): () => void {
    const set = this.listeners.get(event) ?? new Set<Listener>();
    set.add(cb as Listener);
    this.listeners.set(event, set);
    return () => set.delete(cb as Listener);
  }

  close(): void {
    this.closed = true;
    this.clearStuckTimer();
    if (this.reconnectTimer !== null) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.rejectPending(makeError('DISCONNECTED', 'Service connection closed.'));
    this.connectWaiters = [];
    this.socket?.destroy();
    this.socket = null;
    this.connected = false;
  }
}
