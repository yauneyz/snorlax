/**
 * Gradient-filled platform glyphs for the download-page tiles.
 *
 * Paths come from Font Awesome Free 6 brands (CC BY 4.0, https://fontawesome.com/license/free) —
 * the same glyph set the reference design used, but imported rather than pulled off a CDN, so
 * there's no third-party request in the critical path. This is a server component, so the icon
 * data is resolved during render and never ships to the browser.
 *
 * Each icon keeps its own viewBox and is letterboxed into a square by preserveAspectRatio, which
 * gives the row a consistent cap height without distorting any single mark. Gradient ids are
 * suffixed per platform because SVG ids are document-global.
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
  const gradientId = `plat-grad-${platform}`;

  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      width={size}
      height={size}
      preserveAspectRatio="xMidYMid meet"
      aria-hidden="true"
      focusable="false"
    >
      <defs>
        <linearGradient id={gradientId} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#ffffff" />
          <stop offset="0.5" stopColor="#c7ccd4" />
          <stop offset="1" stopColor="#8b9098" />
        </linearGradient>
      </defs>
      <path d={Array.isArray(path) ? path.join(" ") : path} fill={`url(#${gradientId})`} />
    </svg>
  );
}
