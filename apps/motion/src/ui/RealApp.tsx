/**
 * The real desktop app, frame by frame.
 *
 * Renders the renderer's own `App` (sidebar, header, key indicator, the seal, every page), and on
 * each frame pushes the recorded `ServiceState` for that moment into the renderer's own zustand
 * store — the same `applySnapshot` the service's `stateChanged` event calls. What's on screen is
 * therefore exactly what the app shows in that state; the composition only chooses the state.
 */
import React, { useLayoutEffect, useRef } from 'react';
import App, { type Route } from '../../../desktop/src/renderer/App';
import { useFocusStore } from '../../../desktop/src/renderer/store/useFocusStore';
import { UnlockPopup } from '../../../desktop/src/renderer/components/UnlockPopup';
import { applyDesktopPaletteOverrides } from '../../../desktop/src/renderer/lib/desktopPalette';
import { limitsForPlan } from '../../../desktop/src/shared/productLimits';
import '../../../desktop/src/renderer/styles/globals.css';
import { FIXTURES, type StateName } from '../fixtures';

/** The app's natural size. The window frame scales it; the UI lays out as at this size. */
export const APP_W = 1180;
export const APP_H = 740;

function useServiceState(name: StateName) {
  const state = FIXTURES.states[name];
  globalThis.__motionState = state;
  // Clocks in the UI ("Coming up … 11:00 AM", unlock countdowns) read Date.now(); pin it to the
  // recording's clock so a render made on any day shows the same times.
  Date.now = () => state.engine.nowMs;

  useLayoutEffect(() => {
    useFocusStore.setState({
      ready: true,
      onboardingComplete: true,
      signedIn: true,
      entitlementLoaded: true,
      subscriptionPlan: 'pro',
      entitlementActive: true,
      productLimits: limitsForPlan('pro'),
      usingMock: false,
      overridesOpen: false,
    });
    useFocusStore.getState().applySnapshot(state);
  }, [state]);
}

/** Applies the desktop's cyan signal to this subtree only; the page around it stays on-brand. */
function DesktopTheme({ children, style }: { children: React.ReactNode; style?: React.CSSProperties }) {
  const ref = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    if (ref.current) applyDesktopPaletteOverrides(ref.current);
  }, []);
  return (
    <div ref={ref} className="motion-desktop" style={style}>
      {children}
    </div>
  );
}

export function RealApp({ state, route = 'dashboard' }: { state: StateName; route?: Route }) {
  useServiceState(state);
  return (
    <DesktopTheme style={{ width: APP_W, height: APP_H }}>
      {/* Keyed on route: App owns its route state, so a new route is a fresh mount. */}
      <App key={route} initialRoute={route} />
    </DesktopTheme>
  );
}

/** The small window the service opens when it closes a blocked app (here, Discord). */
export function RealAppBlockedPopup({ state }: { state: StateName }) {
  useServiceState(state);
  return (
    <DesktopTheme style={{ width: 420, height: 380, background: 'rgb(var(--color-background))' }}>
      <UnlockPopup target={{ kind: 'app', app: { label: 'Discord', windowsImageName: 'Discord.exe' } }} />
    </DesktopTheme>
  );
}
