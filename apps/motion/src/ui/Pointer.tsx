/**
 * A synthetic pointer and the callouts that point at real UI. Targets are found by their visible
 * text in the live DOM ("Turn off", "Keys"), so if the app's layout changes the pointer follows.
 */
import React, { useLayoutEffect, useState } from 'react';
import { alpha, c, fonts } from '../theme';
import { ramp, track, useTime, visible } from './anim';

export type Point = { x: number; y: number };
export type Rect = Point & { w: number; h: number };

/**
 * Finds the innermost element whose own text is exactly `text`, and returns its box in the
 * coordinate space of `root` (undoing any scale applied to `root` or its ancestors).
 */
export function measure(root: HTMLElement, text: string): Rect | null {
  const candidates = [...root.querySelectorAll<HTMLElement>('button, a, span, div, p, li, h1, h2, h3, label')].filter(
    (el) => el.textContent?.trim() === text,
  );
  // Innermost match: the one with no matching descendant.
  const el = candidates.find((node) => !candidates.some((other) => other !== node && node.contains(other)));
  if (!el) return null;
  const box = root.getBoundingClientRect();
  const scale = box.width / root.offsetWidth || 1;
  const r = el.getBoundingClientRect();
  // Rounded: a zoom moving under sub-pixel layout must not read as the target moving.
  const px = (n: number) => Math.round(n / scale);
  return { x: px(r.left - box.left), y: px(r.top - box.top), w: px(r.width), h: px(r.height) };
}

/** Measures `texts` inside `root` after every render; re-renders only when a box moves. */
export function useAnchors(root: React.RefObject<HTMLElement>, texts: string[]): Record<string, Rect> {
  const [anchors, setAnchors] = useState<Record<string, Rect>>({});
  useLayoutEffect(() => {
    if (!root.current) return;
    const next: Record<string, Rect> = {};
    for (const text of texts) {
      const rect = measure(root.current, text);
      if (rect) next[text] = rect;
    }
    // The camera zooms toward an anchor, which moves the anchor's on-screen box, which is
    // measured back in app space — rounding can wobble by a pixel each pass. Only a real move
    // (or a target appearing or disappearing) counts, so that loop always settles.
    const moved = (a: Rect, b: Rect) => Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y), Math.abs(a.w - b.w), Math.abs(a.h - b.h)) > 2;
    const keys = new Set([...Object.keys(next), ...Object.keys(anchors)]);
    const changed = [...keys].some((key) => !next[key] || !anchors[key] || moved(next[key], anchors[key]));
    if (changed) setAnchors(next);
  });
  return anchors;
}

export const center = (r: Rect): Point => ({ x: r.x + r.w / 2, y: r.y + r.h / 2 });

export type PointerKey = {
  /** Arrival time in seconds; the move takes `travel` seconds before it. */
  at: number;
  to: string | Point;
  click?: boolean;
  travel?: number;
};

export function Pointer({ keys, anchors, start, hideAfter }: { keys: PointerKey[]; anchors: Record<string, Rect>; start: Point; hideAfter?: number }) {
  const t = useTime();
  const resolve = (to: string | Point): Point => (typeof to === 'string' ? (anchors[to] ? center(anchors[to]) : start) : to);

  const xs = [{ at: 0, value: start.x }];
  const ys = [{ at: 0, value: start.y }];
  for (const key of keys) {
    const p = resolve(key.to);
    const leave = key.at - (key.travel ?? 0.8);
    xs.push({ at: leave, value: xs[xs.length - 1]!.value }, { at: key.at, value: p.x });
    ys.push({ at: leave, value: ys[ys.length - 1]!.value }, { at: key.at, value: p.y });
  }
  const x = track(t, xs);
  const y = track(t, ys);

  const clicks = keys.filter((k) => k.click).map((k) => k.at + 0.15);
  const press = clicks.reduce((m, at) => Math.max(m, visible(t, at, at + 0.22, 0.08)), 0);
  const opacity = hideAfter === undefined ? 1 : 1 - ramp(t, hideAfter, 0.3);

  return (
    <div style={{ position: 'absolute', left: 0, top: 0, pointerEvents: 'none', opacity }}>
      {clicks.map((at) => {
        const p = ramp(t, at, 0.5);
        if (p <= 0 || p >= 1) return null;
        return (
          <span
            key={at}
            style={{
              position: 'absolute',
              left: x - 26,
              top: y - 26,
              width: 52,
              height: 52,
              borderRadius: 99,
              border: `2px solid ${alpha(c.white, 0.7 * (1 - p))}`,
              transform: `scale(${0.4 + p})`,
            }}
          />
        );
      })}
      <svg
        width="30"
        height="30"
        viewBox="0 0 24 24"
        style={{ position: 'absolute', left: x - 4, top: y - 2, transform: `scale(${1 - press * 0.15})`, transformOrigin: '4px 2px', filter: `drop-shadow(0 3px 6px ${alpha(c.black, 0.6)})` }}
      >
        <path d="M4 2 L4 19 L8.5 15 L11.5 22 L14.5 20.7 L11.6 14 L18 14 Z" fill={c.white} stroke={c.black} strokeWidth="1.3" strokeLinejoin="round" />
      </svg>
    </div>
  );
}

/** A tooltip-style label anchored under (or above) a real UI element. */
export function Callout({
  anchor,
  text,
  from,
  to,
  tone = 'danger',
  place = 'below',
}: {
  anchor: Rect | undefined;
  text: string;
  from: number;
  to: number;
  tone?: 'danger' | 'signal' | 'plain';
  place?: 'below' | 'below-end' | 'above' | 'right';
}) {
  const t = useTime();
  const shown = visible(t, from, to, 0.25);
  if (!anchor || shown <= 0) return null;
  const color = tone === 'danger' ? c.dangerInk : tone === 'signal' ? c.signal : c.foregroundStrong;
  const border = tone === 'danger' ? alpha(c.danger, 0.55) : tone === 'signal' ? alpha(c.signal, 0.55) : alpha(c.white, 0.2);
  const pos: React.CSSProperties =
    place === 'right'
      ? { left: anchor.x + anchor.w + 18, top: anchor.y + anchor.h / 2, transform: `translate(${(1 - shown) * -8}px, -50%)` }
      : place === 'below-end'
        ? { left: anchor.x + anchor.w, top: anchor.y + anchor.h + 14, transform: `translate(-100%, ${(1 - shown) * -8}px)` }
        : place === 'above'
        ? { left: anchor.x + anchor.w / 2, top: anchor.y - 14, transform: `translate(-50%, calc(-100% + ${(1 - shown) * 8}px))` }
        : { left: anchor.x + anchor.w / 2, top: anchor.y + anchor.h + 14, transform: `translate(-50%, ${(1 - shown) * -8}px)` };
  return (
    <div
      style={{
        position: 'absolute',
        ...pos,
        opacity: shown,
        whiteSpace: 'nowrap',
        padding: '9px 14px',
        borderRadius: 10,
        fontFamily: fonts.sans,
        fontSize: 16,
        fontWeight: 600,
        color,
        background: c.panelRaised,
        border: `1px solid ${border}`,
        boxShadow: `0 12px 30px ${alpha(c.black, 0.55)}`,
        pointerEvents: 'none',
      }}
    >
      {text}
    </div>
  );
}

/** A soft ring drawn around a real UI element to direct attention. */
export function Ring({ anchor, from, to, color = c.danger, pad = 8 }: { anchor: Rect | undefined; from: number; to: number; color?: string; pad?: number }) {
  const t = useTime();
  const shown = visible(t, from, to, 0.25);
  if (!anchor || shown <= 0) return null;
  const pulse = 0.5 + 0.5 * Math.sin((t - from) * Math.PI * 2 * 0.8);
  return (
    <div
      style={{
        position: 'absolute',
        left: anchor.x - pad,
        top: anchor.y - pad,
        width: anchor.w + pad * 2,
        height: anchor.h + pad * 2,
        borderRadius: 999,
        border: `2px solid ${alpha(color, 0.5 + 0.4 * pulse)}`,
        boxShadow: `0 0 ${18 + 14 * pulse}px ${alpha(color, 0.35)}`,
        opacity: shown,
        pointerEvents: 'none',
      }}
    />
  );
}

