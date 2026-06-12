import type { FocusLockApi } from '../preload/index.js';

declare global {
  interface Window {
    api: FocusLockApi;
  }
}

export {};
