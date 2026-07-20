/// <reference types="vite/client" />
import type { TalysmanApi } from '../preload/index.js';

declare global {
  interface Window {
    api: TalysmanApi;
  }
}

export {};
