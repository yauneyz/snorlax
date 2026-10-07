import { ImageResponse } from "next/og";
import { palette } from "@talysman/shared";

export const OG_SIZE = { width: 1200, height: 630 };

const c = palette.colors;

/**
 * The share card for a search page: the group label, the page's H1, and the mechanism drawn as
 * three steps — so someone scrolling past a link in a thread gets the idea without reading the
 * page. Uses next/og's bundled font; no network fetch at build time.
 */
export function intentCard({ label, title }: { label: string; title: string }) {
  const step = (text: string, tone: "plain" | "refused" | "key") => (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        padding: "14px 22px",
        borderRadius: 14,
        fontSize: 26,
        border: `2px solid ${tone === "refused" ? c.danger : tone === "key" ? c.signal : c.border}`,
        color: tone === "refused" ? c.dangerInk : tone === "key" ? c.signal : c.foreground,
        background: c.panel,
      }}
    >
      {text}
    </div>
  );
  const arrow = <div style={{ display: "flex", fontSize: 30, color: c.foregroundDim }}>→</div>;

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          padding: "64px 72px",
          background: c.background,
          color: c.foregroundStrong,
        }}
      >
        <div style={{ display: "flex", flexDirection: "column", gap: 22 }}>
          <div
            style={{
              display: "flex",
              fontSize: 24,
              letterSpacing: 4,
              textTransform: "uppercase",
              color: c.signal,
            }}
          >
            {label}
          </div>
          <div style={{ display: "flex", fontSize: 60, fontWeight: 700, lineHeight: 1.1 }}>
            {title}
          </div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 18 }}>
          {step("End session", "plain")}
          {arrow}
          {step("Refused: no key plugged in", "refused")}
          {arrow}
          {step("The key is in another room", "key")}
        </div>
        <div style={{ display: "flex", fontSize: 28, color: c.foregroundMuted }}>Talysman</div>
      </div>
    ),
    OG_SIZE,
  );
}
