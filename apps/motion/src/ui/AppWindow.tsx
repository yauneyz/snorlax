/**
 * The real app in a platform window, placed on the stage, with a camera and an overlay layer in
 * the app's own coordinates for pointers, callouts and rings.
 */
import React, { useRef } from 'react';
import { AbsoluteFill } from 'remotion';
import type { Route } from '../../../desktop/src/renderer/App';
import type { StateName } from '../fixtures';
import { APP_H, APP_W, RealApp } from './RealApp';
import { OsWindow, TITLEBAR, type Platform } from './Window';
import { center, useAnchors, type Rect } from './Pointer';
import { track, useTime, type Key } from './anim';

export function AppWindow({
  platform = 'windows',
  state,
  route = 'dashboard',
  scale = 1.08,
  offset = { x: 0, y: -30 },
  zoom,
  focus,
  targets = [],
  overlay,
}: {
  platform?: Platform;
  state: StateName;
  route?: Route;
  scale?: number;
  /** Shift from the stage's centre, in stage pixels. */
  offset?: { x: number; y: number };
  /** Camera zoom keyframes, multiplied onto `scale`. */
  zoom?: Key<number>[];
  /** What the camera zooms toward: a UI text target. */
  focus?: string;
  targets?: string[];
  overlay?: (anchors: Record<string, Rect>) => React.ReactNode;
}) {
  const t = useTime();
  const root = useRef<HTMLDivElement>(null);
  const wanted = focus ? [...targets, focus] : targets;
  const anchors = useAnchors(root, wanted);
  const z = zoom ? track(t, zoom) : 1;
  const f = focus && anchors[focus] ? center(anchors[focus]) : { x: APP_W / 2, y: APP_H / 2 };

  return (
    <AbsoluteFill style={{ alignItems: 'center', justifyContent: 'center' }}>
      <div style={{ transform: `translate(${offset.x}px, ${offset.y}px) scale(${scale})` }}>
        <div style={{ transform: `scale(${z})`, transformOrigin: `${f.x}px ${f.y + TITLEBAR}px` }}>
          <OsWindow platform={platform} title="Talysman" width={APP_W} height={APP_H}>
            <div ref={root} style={{ position: 'relative', width: APP_W, height: APP_H }}>
              <RealApp state={state} route={route} />
              <div style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }}>{overlay?.(anchors)}</div>
            </div>
          </OsWindow>
        </div>
      </div>
    </AbsoluteFill>
  );
}
