import React from 'react';
import { createRoot } from 'react-dom/client';
import { applyPaletteVariables } from '@talysman/shared';
import App from './App.js';
import { UnlockPopup } from './components/UnlockPopup.js';
import { ErrorBoundary } from './components/ErrorBoundary.js';
import { applyDesktopPaletteOverrides } from './lib/desktopPalette.js';
import './styles/globals.css';

// Apply the canonical palette before React mounts so the first painted frame has every token.
applyPaletteVariables(document.documentElement);
applyDesktopPaletteOverrides(document.documentElement);

// Catches what the ErrorBoundary can't: exceptions outside React's render tree (event handlers,
// timers, async callbacks) and unhandled promise rejections.
window.addEventListener('error', (event) => {
  void window.api.reportRendererError(event.message, event.error?.stack);
});
window.addEventListener('unhandledrejection', (event) => {
  const reason = event.reason;
  const message = reason instanceof Error ? reason.message : String(reason);
  void window.api.reportRendererError(message, reason instanceof Error ? reason.stack : undefined);
});

const container = document.getElementById('root');
if (!container) throw new Error('#root not found');

// The app-blocked popup window loads this same bundle with ?popup=app&app=<AppRef JSON>.
const query = new URLSearchParams(window.location.search);
const popupApp = query.get('popup') === 'app' ? query.get('app') : null;

createRoot(container).render(
  <React.StrictMode>
    <ErrorBoundary>
      {popupApp ? <UnlockPopup target={{ kind: 'app', app: JSON.parse(popupApp) }} /> : <App />}
    </ErrorBoundary>
  </React.StrictMode>,
);
