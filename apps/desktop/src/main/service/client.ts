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
import type { ServiceConnection, ServiceError } from './connection.js';

const RECONNECT_DELAY_MS = 1500;

interface Pending {
  resolve: (value: unknown) => void;
  reject: (err: ServiceError) => void;
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
  private buffer = '';
  private nextId = 1;
  private pending = new Map<number, Pending>();
  private listeners = new Map<EventName, Set<Listener>>();
  private closed = false;
  private connectWaiters: Array<() => void> = [];

  constructor(private readonly pipePath: string) {}

  connect(): Promise<void> {
    this.closed = false;
    this.open();
    if (this.connected) return Promise.resolve();
    return new Promise((resolve) => this.connectWaiters.push(resolve));
  }

  private open(): void {
    if (this.closed) return;
    const socket = net.connect({ path: this.pipePath });
    this.socket = socket;

    socket.setEncoding('utf8');

    socket.on('connect', () => {
      this.connected = true;
      logger.info(`[service] connected to ${this.pipePath}`);
      this.connectWaiters.forEach((w) => w());
      this.connectWaiters = [];
    });

    socket.on('data', (chunk: string) => this.onData(chunk));

    socket.on('error', (e) => {
      logger.warn(`[service] socket error: ${(e).message}`);
    });

    socket.on('close', () => {
      this.connected = false;
      this.socket = null;
      // Reject anything in flight; the caller can retry.
      for (const [, p] of this.pending) p.reject(makeError('DISCONNECTED', 'Service disconnected.'));
      this.pending.clear();
      if (!this.closed) setTimeout(() => this.open(), RECONNECT_DELAY_MS);
    });
  }

  private onData(chunk: string): void {
    this.buffer += chunk;
    let nl: number;
    while ((nl = this.buffer.indexOf('\n')) !== -1) {
      const line = this.buffer.slice(0, nl).trim();
      this.buffer = this.buffer.slice(nl + 1);
      if (!line) continue;
      try {
        this.dispatch(JSON.parse(line));
      } catch (e) {
        logger.warn(`[service] bad line: ${line}`);
      }
    }
  }

  private dispatch(msg: RpcResponse | EventMessage): void {
    if (msg.kind === 'response') {
      const pending = this.pending.get(msg.id);
      if (!pending) return;
      this.pending.delete(msg.id);
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
      this.pending.set(id, { resolve: resolve as (v: unknown) => void, reject });
      this.socket!.write(`${JSON.stringify(req)}\n`, (e) => {
        if (e) {
          this.pending.delete(id);
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
    this.socket?.destroy();
    this.socket = null;
    this.connected = false;
  }
}
