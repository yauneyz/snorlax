/**
 * Platform glyphs for the download-page tiles and the detected-platform banner.
 *
 * Paths come from Font Awesome Free 6 brands (CC BY 4.0, https://fontawesome.com/license/free) —
 * the same glyph set the reference design used, but imported rather than pulled off a CDN, so
 * there's no third-party request in the critical path. This is a server component, so the icon
 * data is resolved during render and never ships to the browser.
 *
 * Each icon keeps its own viewBox and is letterboxed into a square by preserveAspectRatio, which
 * gives the row a consistent cap height without distorting any single mark. The fill is
 * `currentColor` rather than a gradient so the same mark can appear more than once on a page
 * without colliding SVG ids, and so a tile can tint its glyph on hover.
 */
import {
  faApple,
  faChrome,
  faEdge,
  faFirefoxBrowser,
  faLinux,
  faWindows,
} from "@fortawesome/free-brands-svg-icons";
import type { IconDefinition } from "@fortawesome/free-brands-svg-icons";

export type Platform = "windows" | "macos" | "linux" | "chrome" | "edge" | "firefox";

const icons: Record<Platform, IconDefinition> = {
  windows: faWindows,
  macos: faApple,
  linux: faLinux,
  chrome: faChrome,
  edge: faEdge,
  firefox: faFirefoxBrowser,
};

export function PlatformIcon({ platform, size = 40 }: { platform: Platform; size?: number }) {
  const [width, height, , , path] = icons[platform].icon;

  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      width={size}
      height={size}
      preserveAspectRatio="xMidYMid meet"
      aria-hidden="true"
      focusable="false"
    >
      <path d={Array.isArray(path) ? path.join(" ") : path} fill="currentColor" />
    </svg>
  );
}
