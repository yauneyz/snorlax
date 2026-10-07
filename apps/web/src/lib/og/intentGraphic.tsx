import { readFileSync } from "node:fs";
import { join } from "node:path";
import { ImageResponse } from "next/og";
import { palette } from "@talysman/shared";
import type { GraphicTone, IntentGraphic, IntentPage } from "@/lib/content/intent/types";

/**
 * The search pages' infographics, drawn by Satori (via next/og) at build time. One template per
 * `IntentGraphic` kind; every number and claim comes from the page's own data.
 *
 * Satori needs explicit sizes, so each template estimates its height from how much text it
 * holds. The estimate is generous: a little extra space at the bottom beats clipped text.
 */

export const GRAPHIC_WIDTH = 1600;

const c = palette.colors;
const PAD = 72;
const INNER = GRAPHIC_WIDTH - PAD * 2;

// Read from apps/web's node_modules by path: the bundler would rewrite a require.resolve.
// Runs at build time only (the route is force-static), where the cwd is apps/web.
const font = (pkg: string, file: string) =>
  readFileSync(join(process.cwd(), "node_modules", pkg, "files", file));

function fonts() {
  return [
    { name: "Space Grotesk", data: font("@fontsource/space-grotesk", "space-grotesk-latin-400-normal.woff"), weight: 400 as const },
    { name: "Space Grotesk", data: font("@fontsource/space-grotesk", "space-grotesk-latin-500-normal.woff"), weight: 500 as const },
    { name: "Space Grotesk", data: font("@fontsource/space-grotesk", "space-grotesk-latin-700-normal.woff"), weight: 700 as const },
    { name: "JetBrains Mono", data: font("@fontsource/jetbrains-mono", "jetbrains-mono-latin-400-normal.woff"), weight: 400 as const },
    { name: "JetBrains Mono", data: font("@fontsource/jetbrains-mono", "jetbrains-mono-latin-600-normal.woff"), weight: 600 as const },
  ];
}

const MONO = "JetBrains Mono";

/** Lines a string wraps to in a column `width` px wide at `size` px (Space Grotesk ≈ 0.52em). */
function lines(text: string, width: number, size: number): number {
  const perLine = Math.max(8, Math.floor(width / (size * 0.52)));
  return Math.max(1, Math.ceil(text.length / perLine));
}

// Marks are drawn, not typed: the brand fonts carry no ✕/✓ glyphs, and a missing glyph sends
// Satori to the network for a fallback font.
const TONE: Record<GraphicTone, { path: string; color: string }> = {
  blocked: { path: "M7 7 L17 17 M17 7 L7 17", color: c.dangerInk },
  open: { path: "M6 12.5 L10.5 17 L18 8", color: c.signal },
  cost: { path: "M8 16 L16 8 M10 8 H16 V14", color: c.warning },
  plain: { path: "M6 12 H18 M13 7 L18 12 L13 17", color: c.foregroundMuted },
};

function Glyph({ path, color, size }: { path: string; color: string; size: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={2.6} strokeLinecap="round" strokeLinejoin="round">
      <path d={path} />
    </svg>
  );
}

function Mark({ tone, size = 40 }: { tone: GraphicTone; size?: number }) {
  const t = TONE[tone];
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        width: size,
        height: size,
        flexShrink: 0,
        borderRadius: size,
        border: `2px solid ${t.color}`,
      }}
    >
      <Glyph path={t.path} color={t.color} size={size * 0.6} />
    </div>
  );
}

// ── Templates ───────────────────────────────────────────────────────────────────────────────

type Body = { node: React.ReactNode; height: number };

function table(page: IntentPage, title: string) {
  const section = page.sections.find((s) => s.kind === "table" && s.title === title);
  if (!section || section.kind !== "table") {
    throw new Error(`${page.slug}: graphic references missing table "${title}"`);
  }
  return section;
}

function pickRows(page: IntentPage, title: string, labels: string[]) {
  const section = table(page, title);
  return labels.map((label) => {
    const row = section.rows.find((r) => r[0] === label);
    if (!row) throw new Error(`${page.slug}: no row "${label}" in table "${title}"`);
    return row;
  });
}

function ladder(page: IntentPage, g: Extract<IntentGraphic, { kind: "ladder" }>): Body {
  const rows = pickRows(page, g.fromTable, Object.keys(g.rows));
  const labelW = 470;
  // Row: padding 26 · mark 40 · gap 26 · label · gap 26 · text · padding 26.
  const textW = INNER - labelW - 26 * 4 - 40 - 4;
  const heights = rows.map(([label, text]) => 34 + 34 * Math.max(lines(text!, textW, 25), lines(label!, labelW, 24)));
  return {
    height: heights.reduce((a, b) => a + b, 0) + rows.length * 10,
    node: (
      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        {rows.map(([label, text], i) => {
          const tone = g.rows[label!]!;
          const ours = tone === "open";
          return (
            <div
              key={label}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 26,
                width: INNER,
                height: heights[i],
                padding: "0 26px",
                borderRadius: 16,
                background: ours ? `${c.signal}14` : c.panelRaised,
                border: `1px solid ${ours ? c.signal : c.border}`,
              }}
            >
              <Mark tone={tone} />
              <div style={{ display: "flex", width: labelW, fontFamily: MONO, fontSize: 24, fontWeight: 600, color: c.foregroundStrong }}>
                {label}
              </div>
              <div style={{ display: "flex", width: textW, fontSize: 25, lineHeight: 1.35, color: ours ? c.foregroundStrong : c.foregroundSoft }}>
                {text}
              </div>
            </div>
          );
        })}
      </div>
    ),
  };
}

function compare(page: IntentPage, g: Extract<IntentGraphic, { kind: "compare" }>): Body {
  const section = table(page, g.fromTable);
  const rows = pickRows(page, g.fromTable, g.rows);
  const columns = section.columns.slice(1);
  const labelW = 300;
  const gap = 14;
  const colW = Math.floor((INNER - labelW - gap * columns.length) / columns.length);
  const size = columns.length > 2 ? 21 : 24;
  const heights = rows.map((row) => 36 + 31 * Math.max(...row.slice(1).map((cell) => lines(cell, colW - 40, size)), lines(row[0]!, labelW, 22)));
  // Lit like the page's table: only when that table lights its last column (always ours).
  const ours = section.highlightLast ? columns.length - 1 : -1;
  return {
    height: 70 + heights.reduce((a, b) => a + b + gap, 0),
    node: (
      <div style={{ display: "flex", flexDirection: "column", gap }}>
        <div style={{ display: "flex", gap, height: 56 }}>
          <div style={{ display: "flex", width: labelW }} />
          {columns.map((column, i) => (
            <div
              key={column}
              style={{
                display: "flex",
                alignItems: "center",
                width: colW,
                padding: "0 20px",
                fontSize: 28,
                fontWeight: 700,
                color: i === ours ? c.signal : c.foregroundStrong,
              }}
            >
              {column}
            </div>
          ))}
        </div>
        {rows.map((row, r) => (
          <div key={row[0]} style={{ display: "flex", gap, height: heights[r] }}>
            <div style={{ display: "flex", alignItems: "center", width: labelW, fontFamily: MONO, fontSize: 21, fontWeight: 600, color: c.foregroundMuted }}>
              {row[0]}
            </div>
            {row.slice(1).map((cell, i) => (
              <div
                key={i}
                style={{
                  display: "flex",
                  alignItems: "center",
                  width: colW,
                  padding: "0 20px",
                  borderRadius: 14,
                  fontSize: size,
                  lineHeight: 1.3,
                  color: i === ours ? c.foregroundStrong : c.foregroundSoft,
                  background: i === ours ? `${c.signal}12` : c.panelRaised,
                  border: `1px solid ${i === ours ? c.signal : c.border}`,
                }}
              >
                {cell}
              </div>
            ))}
          </div>
        ))}
      </div>
    ),
  };
}

function rules(page: IntentPage, g: Extract<IntentGraphic, { kind: "rules" }>): Body {
  const sites = pickRows(page, g.fromTable, g.rows).map(([site, hidden, works]) => ({ site: site!, hidden: hidden!, works: works! }));
  const siteW = 220;
  const colW = Math.floor((INNER - siteW - 28) / 2);
  const heights = sites.map((s) => 34 + 32 * Math.max(lines(s.hidden, colW - 90, 24), lines(s.works, colW - 90, 24)));
  const cell = (text: string, tone: GraphicTone, h: number) => (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 18,
        width: colW,
        height: h,
        padding: "0 22px",
        borderRadius: 14,
        background: c.panelRaised,
        border: `1px ${tone === "blocked" ? "dashed" : "solid"} ${tone === "blocked" ? c.neutral600 : c.border}`,
        fontSize: 24,
        lineHeight: 1.3,
        color: tone === "blocked" ? c.foregroundMuted : c.foregroundStrong,
      }}
    >
      <Mark tone={tone} size={34} />
      <div style={{ display: "flex", width: colW - 100 }}>{text}</div>
    </div>
  );
  return {
    height: 60 + heights.reduce((a, b) => a + b + 14, 0),
    node: (
      <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        <div style={{ display: "flex", gap: 14, height: 46, fontFamily: MONO, fontSize: 20, letterSpacing: 3, color: c.foregroundMuted }}>
          <div style={{ display: "flex", width: siteW }} />
          <div style={{ display: "flex", width: colW, color: c.dangerInk }}>HIDDEN BY THE SITE RULE</div>
          <div style={{ display: "flex", width: colW, color: c.signal }}>STILL WORKS</div>
        </div>
        {sites.map((s, i) => (
          <div key={s.site} style={{ display: "flex", gap: 14, alignItems: "center" }}>
            <div style={{ display: "flex", width: siteW, fontSize: 30, fontWeight: 700, color: c.foregroundStrong }}>{s.site}</div>
            {cell(s.hidden, "blocked", heights[i]!)}
            {cell(s.works, "open", heights[i]!)}
          </div>
        ))}
      </div>
    ),
  };
}

const clock = (h: number) => {
  const hh = Math.floor(h);
  const mm = Math.round((h - hh) * 60);
  return `${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}`;
};

function timeline(g: Extract<IntentGraphic, { kind: "timeline" }>): Body {
  const span = g.to - g.from;
  const x = (h: number) => Math.round(((h - g.from) / span) * INNER);
  const axisY = 300;
  const bar = 18;
  // An hour tick under a below-the-axis event would sit on its connector; the event's own
  // time label says the hour anyway.
  const below = g.events.filter((_, i) => i % 2 === 1).map((e) => e.at);
  const hours = Array.from({ length: Math.floor(span) + 1 }, (_, i) => Math.ceil(g.from) + i).filter(
    (h) => h <= g.to && !below.some((at) => Math.abs(at - h) < span * 0.04),
  );
  return {
    height: 600,
    node: (
      <div style={{ display: "flex", position: "relative", width: INNER, height: 600 }}>
        {/* Legend, so the bar itself can stay thin and out of the events' way. */}
        <div style={{ position: "absolute", left: 0, top: 0, display: "flex", alignItems: "center", gap: 14, fontSize: 24, color: c.signal }}>
          <div style={{ display: "flex", width: 34, height: 16, borderRadius: 8, background: `${c.signal}55`, border: `2px solid ${c.signal}` }} />
          {g.window.label}
        </div>
        <div style={{ position: "absolute", left: 0, width: INNER, top: axisY - 1, height: 2, background: c.neutral600, display: "flex" }} />
        <div
          style={{
            position: "absolute",
            left: x(g.window.from),
            width: x(g.window.to) - x(g.window.from),
            top: axisY - bar,
            height: bar * 2,
            borderRadius: bar,
            background: `${c.signal}40`,
            border: `2px solid ${c.signal}`,
            display: "flex",
          }}
        />
        {hours.map((h) => (
          <div key={h} style={{ position: "absolute", left: x(h) - 40, width: 80, top: axisY + bar + 14, display: "flex", justifyContent: "center", fontFamily: MONO, fontSize: 18, color: c.foregroundDim }}>
            {clock(h)}
          </div>
        ))}
        {g.events.map((e, i) => {
          const above = i % 2 === 0;
          const t = TONE[e.tone];
          const left = Math.min(Math.max(x(e.at) - 160, 0), INNER - 320);
          const align = x(e.at) - 160 < 0 ? "flex-start" : x(e.at) + 160 > INNER ? "flex-end" : "center";
          const labelTop = above ? 70 : axisY + 120;
          const labelH = 34 + 30 * lines(e.label, 320, 23);
          return (
            <div key={e.label} style={{ display: "flex" }}>
              <div
                style={{
                  position: "absolute",
                  left: x(e.at) - 1,
                  top: above ? labelTop + labelH : axisY + bar,
                  width: 2,
                  height: above ? axisY - bar - labelTop - labelH : labelTop - axisY - bar - 6,
                  background: t.color,
                  display: "flex",
                }}
              />
              <div style={{ position: "absolute", left: x(e.at) - 10, top: axisY - 10, width: 20, height: 20, borderRadius: 20, background: t.color, border: `3px solid ${c.background}`, display: "flex" }} />
              <div style={{ position: "absolute", left, width: 320, top: labelTop, display: "flex", flexDirection: "column", alignItems: align, gap: 4 }}>
                <div style={{ display: "flex", fontFamily: MONO, fontSize: 20, fontWeight: 600, color: t.color }}>{clock(e.at)}</div>
                <div style={{ display: "flex", fontSize: 23, lineHeight: 1.25, color: c.foregroundStrong, textAlign: align === "center" ? "center" : align === "flex-end" ? "right" : "left" }}>
                  {e.label}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    ),
  };
}

function states(g: Extract<IntentGraphic, { kind: "states" }>): Body {
  const gap = 46;
  const w = Math.floor((INNER - gap * (g.states.length - 1)) / g.states.length);
  const cardH = 90 + 32 * Math.max(...g.states.map((s) => lines(s.text, w - 48, 23)));
  const notesH = (g.notes ?? []).reduce((h, n) => h + 20 + 34 * lines(n, INNER - 60, 24), 0);
  return {
    height: cardH + (notesH ? notesH + 60 : 0),
    node: (
      <div style={{ display: "flex", flexDirection: "column", gap: 40 }}>
        <div style={{ display: "flex", alignItems: "center" }}>
          {g.states.map((s, i) => {
            const t = TONE[s.tone];
            return (
              <div key={s.label} style={{ display: "flex", alignItems: "center" }}>
                <div
                  style={{
                    display: "flex",
                    flexDirection: "column",
                    gap: 12,
                    width: w,
                    height: cardH,
                    padding: 24,
                    borderRadius: 16,
                    background: c.panelRaised,
                    border: `2px solid ${s.tone === "plain" ? c.border : t.color}`,
                  }}
                >
                  <div style={{ display: "flex", alignItems: "center", gap: 12, fontFamily: MONO, fontSize: 20, fontWeight: 600, letterSpacing: 2, color: s.tone === "plain" ? c.foregroundStrong : t.color }}>
                    {s.label.toUpperCase()}
                  </div>
                  <div style={{ display: "flex", fontSize: 23, lineHeight: 1.35, color: c.foregroundSoft }}>{s.text}</div>
                </div>
                {i < g.states.length - 1 ? (
                  <div style={{ display: "flex", width: gap, justifyContent: "center" }}>
                    <Glyph path={TONE.plain.path} color={c.foregroundDim} size={30} />
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>
        {g.notes?.length ? (
          <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
            {g.notes.map((note) => (
              <div key={note} style={{ display: "flex", gap: 18, fontSize: 24, lineHeight: 1.4, color: c.foregroundSoft }}>
                <div style={{ display: "flex", width: 12, height: 12, marginTop: 12, borderRadius: 12, background: c.signal }} />
                <div style={{ display: "flex", width: INNER - 60 }}>{note}</div>
              </div>
            ))}
          </div>
        ) : null}
      </div>
    ),
  };
}

function body(page: IntentPage): Body {
  const g = page.graphic;
  switch (g.kind) {
    case "ladder":
      return ladder(page, g);
    case "compare":
      return compare(page, g);
    case "rules":
      return rules(page, g);
    case "timeline":
      return timeline(g);
    case "states":
      return states(g);
  }
}

function formatMonth(iso: string) {
  return new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-US", { month: "long", year: "numeric", timeZone: "UTC" });
}

/** The graphic's full size, for width/height on the <img>. */
export function graphicSize(page: IntentPage) {
  // Bold display type runs wider than the body estimate; measure it as if larger.
  const titleH = 64 * lines(page.graphic.title, INNER, 62);
  return { width: GRAPHIC_WIDTH, height: PAD + 40 + 26 + titleH + 48 + body(page).height + 56 + 40 + PAD };
}

export function intentGraphic(page: IntentPage, { label }: { label: string }) {
  const { node } = body(page);
  const size = graphicSize(page);
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          padding: PAD,
          background: c.background,
          color: c.foreground,
          fontFamily: "Space Grotesk",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", height: 40, fontFamily: MONO, fontSize: 20, letterSpacing: 4, color: c.signal }}>
          {label.toUpperCase()}
        </div>
        <div style={{ display: "flex", marginTop: 26, fontSize: 56, fontWeight: 700, lineHeight: 1.14, color: c.foregroundStrong }}>
          {page.graphic.title}
        </div>
        <div style={{ display: "flex", marginTop: 48 }}>{node}</div>
        <div style={{ display: "flex", marginTop: "auto", alignItems: "center", gap: 20, height: 40, fontSize: 22, color: c.foregroundDim }}>
          <div style={{ display: "flex", fontWeight: 700, letterSpacing: 4, color: c.foregroundSoft }}>TALYSMAN</div>
          <div style={{ display: "flex", fontFamily: MONO }}>talysman.app/{page.slug}</div>
          {page.showLastReviewed ? <div style={{ display: "flex", marginLeft: "auto" }}>Last checked {formatMonth(page.lastReviewed)}</div> : null}
        </div>
      </div>
    ),
    { ...size, fonts: fonts() },
  );
}
