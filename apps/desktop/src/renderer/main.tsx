import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.js';
import { ErrorBoundary } from './components/ErrorBoundary.js';
import './styles/globals.css';

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
createRoot(container).render(
  <React.StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </React.StrictMode>,
);
