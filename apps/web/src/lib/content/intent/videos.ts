import manifest from "./demo-videos.json";

/**
 * The demo videos rendered by apps/motion (`pnpm --filter @talysman/motion render`), keyed by
 * page slug. The render script writes demo-videos.json alongside the files in
 * public/media/demos; a page without an entry falls back to the refusal screenshot.
 */
export type DemoVideoInfo = {
  description: string;
  /** ISO 8601, for VideoObject. */
  duration: string;
  seconds: number;
  uploadDate: string;
  width: number;
  height: number;
};

const videos = manifest as Record<string, DemoVideoInfo>;

export function demoVideo(slug: string): DemoVideoInfo | null {
  return videos[slug] ?? null;
}
