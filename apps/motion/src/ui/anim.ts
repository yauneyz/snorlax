import { Easing, interpolate, useCurrentFrame } from 'remotion';
import { FPS } from '../theme';

/** The current time in seconds — scripts are written in seconds, not frames. */
export function useTime(): number {
  return useCurrentFrame() / FPS;
}

const smooth = Easing.bezier(0.33, 0, 0.2, 1);

/** 0 → 1 over [start, start + duration] seconds, eased. */
export function ramp(t: number, start: number, duration = 0.4, easing = smooth): number {
  return interpolate(t, [start, start + duration], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
    easing,
  });
}

/** 1 while inside [start, end], with eased fades at both edges. */
export function visible(t: number, start: number, end: number, fade = 0.35): number {
  return Math.min(ramp(t, start, fade), 1 - ramp(t, end - fade, fade));
}

export type Key<V> = { at: number; value: V };

/** Interpolates numeric keyframes (seconds → value) with easing between each pair. */
export function track(t: number, keys: Key<number>[]): number {
  if (keys.length === 0) return 0;
  if (t <= keys[0]!.at) return keys[0]!.value;
  for (let i = 1; i < keys.length; i += 1) {
    const a = keys[i - 1]!;
    const b = keys[i]!;
    if (t <= b.at) return a.value + (b.value - a.value) * smooth((t - a.at) / (b.at - a.at || 1));
  }
  return keys[keys.length - 1]!.value;
}

/** The last keyed value at or before `t` — for discrete things like UI states. */
export function step<V>(t: number, keys: Key<V>[]): V {
  let value = keys[0]!.value;
  for (const key of keys) if (t >= key.at) value = key.value;
  return value;
}

/** How much of `text` has been typed by `t`, at `cps` characters per second from `start`. */
export function typed(text: string, t: number, start: number, cps = 18): string {
  return text.slice(0, Math.max(0, Math.floor((t - start) * cps)));
}

export { FPS };
