/**
 * The interface the main process uses to talk to the privileged service. Two implementations:
 *  - PipeServiceConnection (client.ts): real NDJSON-RPC over the native service endpoint.
 *  - MockServiceConnection (mockService.ts): in-process fake for dev/WSL/tests.
 *
 * `index.ts` picks one at startup so the rest of main is agnostic.
 */

import type {
  EventName,
  EventPayload,
  Method,
  Params,
  Result,
} from '@focuslock/shared';

export interface ServiceError extends Error {
  code: string;
}

export function isServiceError(e: unknown): e is ServiceError {
  return e instanceof Error && typeof (e as ServiceError).code === 'string';
}

export interface ServiceConnection {
  /** Establish (or begin maintaining) the connection. Resolves once first connected. */
  connect(): Promise<void>;
  /** Issue an RPC. Rejects with a ServiceError carrying `code` on a protocol error. */
  request<M extends Method>(method: M, params: Params<M>): Promise<Result<M>>;
  /** Subscribe to a pushed event; returns an unsubscribe function. */
  on<E extends EventName>(event: E, cb: (payload: EventPayload<E>) => void): () => void;
  /** True while the underlying transport is connected. */
  readonly connected: boolean;
  close(): void;
}
