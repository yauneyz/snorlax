import React from 'react';
import { palette } from '@talysman/shared';

interface Props {
  children: React.ReactNode;
}

interface State {
  error: Error | null;
}

/**
 * Last-resort catch for errors thrown during React's render/commit/lifecycle phases — the one
 * class of renderer error `window.onerror`/`unhandledrejection` (wired in main.tsx) cannot see,
 * since React intercepts those itself. Without this, a component throwing after the window has
 * loaded just blanks the UI with zero signal anywhere.
 */
export class ErrorBoundary extends React.Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error): void {
    void window.api.reportRendererError(error.message, error.stack);
  }

  render(): React.ReactNode {
    if (this.state.error) {
      return (
        <div
          style={{
            padding: 32,
            color: palette.colors.foregroundStrong,
            background: palette.colors.panel,
            height: '100vh',
          }}
        >
          <h2>Something went wrong.</h2>
          <p style={{ color: palette.colors.foregroundMuted }}>
            Please restart Talysman. This has been reported.
          </p>
        </div>
      );
    }
    return this.props.children;
  }
}
