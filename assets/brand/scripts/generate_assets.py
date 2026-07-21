#!/usr/bin/env python3
from __future__ import annotations

import io
import json
import shutil
import struct
import subprocess
from pathlib import Path
from textwrap import dedent

import cairosvg
from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / "source"
GENERATED = ROOT / "generated"

COLORS = {
    "background": "#08090a",
    "panel": "#0e0f11",
    "panel2": "#16181b",
    "border": "#26292e",
    "accent": "#c7ccd4",
    "accent_ink": "#0a0b0d",
    "body": "#dcdee2",
    "highlight": "#f2f3f5",
    "midtone": "#8b9098",
    "success": "#22c55e",
    "danger": "#ef4444",
    "warning": "#f59e0b",
}

FULL_MASK_SHAPES = """
  <path d="M160 90 L256 34 L352 90 L326 105 L256 64 L186 105 Z"/>
  <path d="M76 108 L226 149 L226 181 L111 150 L111 193 L151 213 L133 242 L76 213 Z"/>
  <path d="M126 164 L197 183 L197 222 L171 211 L171 201 L126 188 Z"/>
  <path d="M76 234 L111 252 L111 304 L200 346 L200 379 L76 322 Z"/>
  <path d="M126 264 L171 284 L171 316 L126 294 Z"/>
  <path d="M78 343 L200 399 L200 433 L112 383 Z"/>
  <g transform="translate(512 0) scale(-1 1)">
    <path d="M76 108 L226 149 L226 181 L111 150 L111 193 L151 213 L133 242 L76 213 Z"/>
    <path d="M126 164 L197 183 L197 222 L171 211 L171 201 L126 188 Z"/>
    <path d="M76 234 L111 252 L111 304 L200 346 L200 379 L76 322 Z"/>
    <path d="M126 264 L171 284 L171 316 L126 294 Z"/>
    <path d="M78 343 L200 399 L200 433 L112 383 Z"/>
  </g>
  <path d="M201 140 H311 V174 H276 V329 H302 V428 L256 463 L210 428 V329 H236 V174 H201 Z"/>
"""

FULL_MASK_CUTOUTS = """
  <path d="M256 232 L273 249 L256 266 L239 249 Z"/>
  <rect x="249" y="263" width="14" height="53" rx="4"/>
  <rect x="229" y="367" width="18" height="22" rx="2"/>
  <rect x="265" y="367" width="18" height="22" rx="2"/>
"""

SMALL_MASK_SHAPES = """
  <path d="M160 92 L256 36 L352 92 L326 108 L256 66 L186 108 Z"/>
  <path d="M80 112 L224 151 L224 184 L114 154 L114 194 L150 213 L132 242 L80 216 Z"/>
  <path d="M80 235 L114 252 L114 304 L199 344 L199 382 L80 326 Z"/>
  <path d="M80 344 L199 399 L199 434 L113 385 Z"/>
  <g transform="translate(512 0) scale(-1 1)">
    <path d="M80 112 L224 151 L224 184 L114 154 L114 194 L150 213 L132 242 L80 216 Z"/>
    <path d="M80 235 L114 252 L114 304 L199 344 L199 382 L80 326 Z"/>
    <path d="M80 344 L199 399 L199 434 L113 385 Z"/>
  </g>
  <path d="M198 140 H314 V177 H277 V331 H305 V430 L256 466 L207 430 V331 H235 V177 H198 Z"/>
"""

SMALL_MASK_CUTOUTS = """
  <path d="M256 234 L274 252 L256 270 L238 252 Z"/>
  <rect x="249" y="267" width="14" height="50" rx="4"/>
  <rect x="228" y="369" width="20" height="23" rx="2"/>
  <rect x="264" y="369" width="20" height="23" rx="2"/>
"""

MICRO_MASK_SHAPES = """
  <path d="M160 98 L256 42 L352 98 L322 116 L256 77 L190 116 Z"/>
  <path d="M79 119 L226 158 L226 196 L119 168 L119 209 L158 230 L136 264 L79 232 Z"/>
  <path d="M79 246 L119 265 L119 312 L205 352 L205 399 L79 340 Z"/>
  <g transform="translate(512 0) scale(-1 1)">
    <path d="M79 119 L226 158 L226 196 L119 168 L119 209 L158 230 L136 264 L79 232 Z"/>
    <path d="M79 246 L119 265 L119 312 L205 352 L205 399 L79 340 Z"/>
  </g>
  <path d="M194 149 H318 V190 H278 V337 H309 V431 L256 470 L203 431 V337 H234 V190 H194 Z"/>
"""

MICRO_MASK_CUTOUTS = """
  <path d="M256 239 L276 259 L256 279 L236 259 Z"/>
  <rect x="248" y="276" width="16" height="43" rx="4"/>
"""


def svg_defs(mask_id: str, shapes: str, cutouts: str) -> str:
    return f"""
    <defs>
      <linearGradient id="silver" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0" stop-color="{COLORS['highlight']}"/>
        <stop offset="0.48" stop-color="{COLORS['accent']}"/>
        <stop offset="1" stop-color="{COLORS['midtone']}"/>
      </linearGradient>
      <radialGradient id="panelGlow" cx="48%" cy="38%" r="74%">
        <stop offset="0" stop-color="{COLORS['panel2']}"/>
        <stop offset="0.72" stop-color="{COLORS['panel']}"/>
        <stop offset="1" stop-color="{COLORS['background']}"/>
      </radialGradient>
      <filter id="softShadow" x="-20%" y="-20%" width="140%" height="150%">
        <feDropShadow dx="0" dy="15" stdDeviation="18" flood-color="#000000" flood-opacity="0.55"/>
      </filter>
      <mask id="{mask_id}" maskUnits="userSpaceOnUse" x="0" y="0" width="512" height="512">
        <g fill="#fff">{shapes}</g>
        <g fill="#000">{cutouts}</g>
      </mask>
    </defs>
    """


def mark_svg(variant: str = "full", flat: bool = False) -> str:
    shapes, cuts = {
        "full": (FULL_MASK_SHAPES, FULL_MASK_CUTOUTS),
        "small": (SMALL_MASK_SHAPES, SMALL_MASK_CUTOUTS),
        "micro": (MICRO_MASK_SHAPES, MICRO_MASK_CUTOUTS),
    }[variant]
    fill = COLORS["accent"] if flat else "url(#silver)"
    return dedent(f"""\
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" role="img" aria-label="Talysman logo mark">
      <title>Talysman logo mark</title>
      {svg_defs('markMask', shapes, cuts)}
      <rect width="512" height="512" fill="{fill}" mask="url(#markMask)"/>
    </svg>
    """)


def tray_svg() -> str:
    return dedent(f"""\
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" role="img" aria-label="Talysman tray icon" style="color:{COLORS['highlight']}">
      <title>Talysman tray icon</title>
      <defs>
        <mask id="trayMask" maskUnits="userSpaceOnUse" x="0" y="0" width="512" height="512">
          <g fill="#fff">{MICRO_MASK_SHAPES}</g>
          <g fill="#000">{MICRO_MASK_CUTOUTS}</g>
        </mask>
      </defs>
      <rect width="512" height="512" fill="currentColor" mask="url(#trayMask)"/>
    </svg>
    """)


def app_icon_svg(variant: str = "full", maskable: bool = False) -> str:
    shapes, cuts = {
        "full": (FULL_MASK_SHAPES, FULL_MASK_CUTOUTS),
        "small": (SMALL_MASK_SHAPES, SMALL_MASK_CUTOUTS),
        "micro": (MICRO_MASK_SHAPES, MICRO_MASK_CUTOUTS),
    }[variant]
    # Optical scaling: micro and small variants occupy more of the canvas so they
    # remain legible in taskbars, launchers and browser tabs. Maskable artwork
    # stays within the PWA safe zone.
    if maskable:
        scale = 1.02
    elif variant == "micro":
        scale = 1.52
    elif variant == "small":
        scale = 1.38
    else:
        scale = 1.20
    tx = (1024 - 512 * scale) / 2
    ty = (1024 - 512 * scale) / 2 + (8 if variant == "full" and not maskable else 0)
    radius = 220 if not maskable else 0
    return dedent(f"""\
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024" role="img" aria-label="Talysman app icon">
      <title>Talysman app icon</title>
      {svg_defs('appMask', shapes, cuts)}
      <rect width="1024" height="1024" rx="{radius}" fill="url(#panelGlow)"/>
      <rect x="16" y="16" width="992" height="992" rx="{max(radius-12,0)}" fill="none" stroke="{COLORS['border']}" stroke-width="{3 if variant == 'full' else 0}"/>
      <g transform="translate({tx:.2f} {ty:.2f}) scale({scale:.5f})"{(' filter="url(#softShadow)"' if variant == 'full' and not maskable else '')}>
        <rect width="512" height="512" fill="url(#silver)" mask="url(#appMask)"/>
      </g>
    </svg>
    """)


def wordmark_svg(outlined: bool = False) -> str:
    # Outlining is performed later with Inkscape; this function returns editable text.
    return dedent(f"""\
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1240 220" role="img" aria-label="Talysman wordmark">
      <title>Talysman wordmark</title>
      <defs>
        <linearGradient id="silverText" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stop-color="{COLORS['highlight']}"/>
          <stop offset="0.52" stop-color="{COLORS['accent']}"/>
          <stop offset="1" stop-color="{COLORS['midtone']}"/>
        </linearGradient>
      </defs>
      <text x="38" y="158" fill="url(#silverText)" font-family="Inter, Arial, sans-serif" font-size="132" font-weight="400" letter-spacing="24">TALYSMAN</text>
    </svg>
    """)


def lockup_svg() -> str:
    return dedent(f"""\
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1740 520" role="img" aria-label="Talysman logo lockup">
      <title>Talysman logo lockup</title>
      {svg_defs('lockupMask', FULL_MASK_SHAPES, FULL_MASK_CUTOUTS)}
      <g transform="translate(42 24) scale(.92)">
        <rect width="512" height="512" fill="url(#silver)" mask="url(#lockupMask)"/>
      </g>
      <text x="570" y="310" fill="url(#silver)" font-family="Inter, Arial, sans-serif" font-size="150" font-weight="400" letter-spacing="25">TALYSMAN</text>
    </svg>
    """)


def lockup_tagline_svg() -> str:
    return dedent(f"""\
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1740 620" role="img" aria-label="Talysman logo with tagline">
      <title>Talysman logo with tagline</title>
      {svg_defs('lockupMask2', FULL_MASK_SHAPES, FULL_MASK_CUTOUTS)}
      <g transform="translate(42 24) scale(.92)">
        <rect width="512" height="512" fill="url(#silver)" mask="url(#lockupMask2)"/>
      </g>
      <text x="570" y="280" fill="url(#silver)" font-family="Inter, Arial, sans-serif" font-size="150" font-weight="400" letter-spacing="25">TALYSMAN</text>
      <text x="578" y="370" fill="{COLORS['midtone']}" font-family="Inter, Arial, sans-serif" font-size="38" font-weight="500" letter-spacing="15">FOCUS · CONTROL · FREEDOM</text>
    </svg>
    """)


def render_svg(svg: str, size: int | tuple[int, int]) -> Image.Image:
    if isinstance(size, int):
        width = height = size
    else:
        width, height = size
    png = cairosvg.svg2png(bytestring=svg.encode("utf-8"), output_width=width, output_height=height)
    return Image.open(io.BytesIO(png)).convert("RGBA")


def save_png(image: Image.Image, path: Path) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    image.save(path, "PNG", optimize=True, compress_level=9)


def source_for_size(size: int) -> str:
    if size <= 24:
        return app_icon_svg("micro")
    if size <= 64:
        return app_icon_svg("small")
    return app_icon_svg("full")


def transparent_mark_for_size(size: int, black: bool = False) -> Image.Image:
    variant = "micro" if size <= 24 else "small" if size <= 64 else "full"
    svg = tray_svg() if black else mark_svg(variant, flat=True)
    image = render_svg(svg, size)
    if black:
        # Template images use opaque black plus alpha; macOS recolors them.
        alpha = image.getchannel("A")
        black_image = Image.new("RGBA", image.size, (0, 0, 0, 0))
        black_image.putalpha(alpha)
        return black_image
    return image


def write_icns(path: Path, frames: dict[int, bytes]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    type_map = [
        ("icp4", 16), ("icp5", 32), ("icp6", 64),
        ("ic07", 128), ("ic08", 256), ("ic09", 512), ("ic10", 1024),
        ("ic11", 32), ("ic12", 64), ("ic13", 256), ("ic14", 512),
    ]
    elements = []
    for type_code, size in type_map:
        data = frames[size]
        elements.append(type_code.encode("ascii") + struct.pack(">I", len(data) + 8) + data)
    body = b"".join(elements)
    path.write_bytes(b"icns" + struct.pack(">I", len(body) + 8) + body)


def png_bytes(im: Image.Image) -> bytes:
    out = io.BytesIO()
    im.save(out, "PNG", optimize=True, compress_level=9)
    return out.getvalue()


def create_outlined_svg(input_path: Path, output_path: Path) -> None:
    try:
        subprocess.run([
            "inkscape", str(input_path), "--export-text-to-path",
            f"--export-filename={output_path}"
        ], check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    except Exception:
        shutil.copy2(input_path, output_path)


def create_preview() -> None:
    canvas = Image.new("RGB", (1800, 1180), COLORS["background"])
    draw = ImageDraw.Draw(canvas)
    try:
        font_title = ImageFont.truetype("/usr/share/fonts/opentype/inter/InterDisplay-Medium.otf", 56)
        font_sub = ImageFont.truetype("/usr/share/fonts/opentype/inter/Inter-Regular.otf", 28)
    except Exception:
        font_title = ImageFont.load_default()
        font_sub = ImageFont.load_default()

    draw.text((90, 64), "Talysman logo asset kit", fill=COLORS["body"], font=font_title)
    draw.text((92, 136), "Silver #c7ccd4 on near-black #08090a", fill=COLORS["midtone"], font=font_sub)

    icon = render_svg(app_icon_svg("full"), 620)
    canvas.paste(icon.convert("RGB"), (90, 230))

    lockup = render_svg(lockup_svg(), (960, 287))
    canvas.paste(lockup, (790, 255), lockup)

    sizes = [128, 64, 32, 24, 16]
    x = 805
    y = 650
    for s in sizes:
        img = render_svg(source_for_size(s), s)
        scale = max(1, 128 // s)
        display = img.resize((s * scale, s * scale), Image.Resampling.NEAREST)
        canvas.paste(display.convert("RGB"), (x, y))
        draw.text((x, y + 145), f"{s}px", fill=COLORS["midtone"], font=font_sub)
        x += 180

    tray = transparent_mark_for_size(128, black=False)
    chip = Image.new("RGB", (310, 190), COLORS["panel2"])
    chip.paste(tray, (25, 25), tray)
    draw_chip = ImageDraw.Draw(chip)
    draw_chip.text((170, 78), "Tray glyph", fill=COLORS["body"], font=font_sub)
    canvas.paste(chip, (790, 910))

    save_png(canvas.convert("RGBA"), GENERATED / "previews" / "talysman-asset-sheet.png")


def main() -> None:
    if GENERATED.exists():
        shutil.rmtree(GENERATED)
    SOURCE.mkdir(parents=True, exist_ok=True)

    source_files = {
        "talysman-mark.svg": mark_svg("full"),
        "talysman-app-icon.svg": app_icon_svg("full"),
        "talysman-app-icon-small.svg": app_icon_svg("small"),
        "talysman-app-icon-micro.svg": app_icon_svg("micro"),
        "talysman-app-icon-maskable.svg": app_icon_svg("full", maskable=True),
        "talysman-tray.svg": tray_svg(),
        "talysman-wordmark.svg": wordmark_svg(),
        "talysman-lockup.svg": lockup_svg(),
        "talysman-lockup-tagline.svg": lockup_tagline_svg(),
    }
    for name, content in source_files.items():
        (SOURCE / name).write_text(content, encoding="utf-8")

    (SOURCE / "brand-tokens.json").write_text(json.dumps({
        "name": "Talysman",
        "palette": COLORS,
        "neutralRamp": ["#fafafa", "#f2f3f5", "#dcdee2", "#b8bcc4", "#8b9098", "#676c74", "#4d5158", "#3a3d43", "#26292e", "#17191c", "#0e0f11"]
    }, indent=2) + "\n", encoding="utf-8")

    create_outlined_svg(SOURCE / "talysman-wordmark.svg", SOURCE / "talysman-wordmark-outlined.svg")
    create_outlined_svg(SOURCE / "talysman-lockup.svg", SOURCE / "talysman-lockup-outlined.svg")
    create_outlined_svg(SOURCE / "talysman-lockup-tagline.svg", SOURCE / "talysman-lockup-tagline-outlined.svg")

    # Universal master and transparent brand exports.
    save_png(render_svg(app_icon_svg("full"), 1024), GENERATED / "master" / "talysman-app-icon-1024.png")
    save_png(render_svg(mark_svg("full"), 1024), GENERATED / "master" / "talysman-mark-1024-transparent.png")
    save_png(render_svg(lockup_svg(), (1740, 520)), GENERATED / "master" / "talysman-lockup-1740x520.png")
    save_png(render_svg(lockup_tagline_svg(), (1740, 620)), GENERATED / "master" / "talysman-lockup-tagline-1740x620.png")

    # Shared tailored raster frames.
    all_sizes = [16, 20, 24, 32, 40, 48, 64, 128, 180, 192, 256, 512, 1024]
    frames: dict[int, Image.Image] = {}
    for size in all_sizes:
        frames[size] = render_svg(source_for_size(size), size)

    # Windows app PNGs and ICO.
    win_png = GENERATED / "windows" / "png"
    for size in [16, 20, 24, 32, 40, 48, 64, 128, 256]:
        save_png(frames[size], win_png / f"icon-{size}.png")
    ico_inputs = [win_png / f"icon-{size}.png" for size in [16, 20, 24, 32, 40, 48, 64, 128, 256]]
    subprocess.run(["magick", *map(str, ico_inputs), str(GENERATED / "windows" / "icon.ico")], check=True)

    tray_win = GENERATED / "windows" / "tray"
    tray_inputs = []
    for size in [16, 20, 24, 32]:
        im = transparent_mark_for_size(size)
        p = tray_win / f"tray-{size}.png"
        save_png(im, p)
        tray_inputs.append(p)
    subprocess.run(["magick", *map(str, tray_inputs), str(GENERATED / "windows" / "tray.ico")], check=True)

    # macOS ICNS and iconset source directory.
    iconset = GENERATED / "macos" / "Talysman.iconset"
    iconset.mkdir(parents=True, exist_ok=True)
    iconset_map = {
        "icon_16x16.png": 16,
        "icon_16x16@2x.png": 32,
        "icon_32x32.png": 32,
        "icon_32x32@2x.png": 64,
        "icon_128x128.png": 128,
        "icon_128x128@2x.png": 256,
        "icon_256x256.png": 256,
        "icon_256x256@2x.png": 512,
        "icon_512x512.png": 512,
        "icon_512x512@2x.png": 1024,
    }
    for name, size in iconset_map.items():
        save_png(frames[size], iconset / name)
    icns_frames = {size: png_bytes(frames[size]) for size in [16, 32, 64, 128, 256, 512, 1024]}
    write_icns(GENERATED / "macos" / "icon.icns", icns_frames)

    # macOS menu-bar template images.
    mac_tray = GENERATED / "macos" / "tray"
    save_png(transparent_mark_for_size(16, black=True), mac_tray / "TalysmanTemplate.png")
    save_png(transparent_mark_for_size(32, black=True), mac_tray / "TalysmanTemplate@2x.png")

    # Linux app icons and scalable SVG.
    linux = GENERATED / "linux"
    for size in [16, 24, 32, 48, 64, 128, 256, 512]:
        save_png(frames[size], linux / f"{size}x{size}.png")
    scalable = linux / "scalable"
    scalable.mkdir(parents=True, exist_ok=True)
    shutil.copy2(SOURCE / "talysman-app-icon.svg", scalable / "talysman.svg")
    linux_tray = linux / "tray"
    for size in [16, 24, 32]:
        save_png(transparent_mark_for_size(size), linux_tray / f"talysman-tray-{size}.png")
    shutil.copy2(SOURCE / "talysman-tray.svg", linux_tray / "talysman-tray.svg")

    # Web assets.
    web = GENERATED / "web"
    web.mkdir(parents=True, exist_ok=True)
    shutil.copy2(SOURCE / "talysman-app-icon-micro.svg", web / "favicon.svg")
    save_png(frames[16], web / "favicon-16x16.png")
    save_png(frames[32], web / "favicon-32x32.png")
    save_png(frames[48], web / "favicon-48x48.png")
    subprocess.run(["magick", str(web / "favicon-16x16.png"), str(web / "favicon-32x32.png"), str(web / "favicon-48x48.png"), str(web / "favicon.ico")], check=True)
    save_png(frames[180], web / "apple-touch-icon.png")
    save_png(frames[192], web / "icon-192.png")
    save_png(frames[512], web / "icon-512.png")
    save_png(render_svg(app_icon_svg("full", maskable=True), 192), web / "icon-maskable-192.png")
    save_png(render_svg(app_icon_svg("full", maskable=True), 512), web / "icon-maskable-512.png")
    manifest = {
        "name": "Talysman",
        "short_name": "Talysman",
        "icons": [
            {"src": "/icons/icon-192.png", "sizes": "192x192", "type": "image/png", "purpose": "any"},
            {"src": "/icons/icon-512.png", "sizes": "512x512", "type": "image/png", "purpose": "any"},
            {"src": "/icons/icon-maskable-192.png", "sizes": "192x192", "type": "image/png", "purpose": "maskable"},
            {"src": "/icons/icon-maskable-512.png", "sizes": "512x512", "type": "image/png", "purpose": "maskable"},
        ],
        "theme_color": COLORS["background"],
        "background_color": COLORS["background"],
        "display": "standalone",
    }
    (web / "manifest.webmanifest").write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")
    (web / "head-snippet.html").write_text(dedent("""\
        <link rel="icon" href="/favicon.ico" sizes="any">
        <link rel="icon" href="/favicon.svg" type="image/svg+xml">
        <link rel="apple-touch-icon" href="/apple-touch-icon.png">
        <link rel="manifest" href="/manifest.webmanifest">
        <meta name="theme-color" content="#08090a">
    """), encoding="utf-8")

    # Electron configuration snippets.
    snippets = ROOT / "integration"
    snippets.mkdir(parents=True, exist_ok=True)
    (snippets / "electron-builder.example.json").write_text(json.dumps({
        "build": {
            "directories": {"buildResources": "assets/brand/generated"},
            "mac": {"icon": "assets/brand/generated/macos/icon.icns"},
            "win": {"icon": "assets/brand/generated/windows/icon.ico"},
            "linux": {"icon": "assets/brand/generated/linux"}
        }
    }, indent=2) + "\n", encoding="utf-8")

    create_preview()

    readme = dedent(f"""\
    # Talysman logo asset kit

    This package reconstructs the approved concept as a clean, scalable vector system using the Talysman palette:

    - Silver: `{COLORS['accent']}`
    - Near-black: `{COLORS['background']}`
    - Mid-tone: `{COLORS['midtone']}`
    - Highlight: `{COLORS['highlight']}`

    ## Important note

    The original design was generated as concept artwork rather than supplied as vector geometry. These files are a hand-built vector reconstruction designed to stay recognizable at desktop-icon and tray-icon sizes. Review the shape and spacing before registering trademarks or commissioning physical packaging.

    ## Source of truth

    Keep `source/` under version control. Everything in `generated/` can be regenerated by running:

    ```bash
    python scripts/generate_assets.py
    ```

    The generator requires Python 3, Pillow, CairoSVG, ImageMagick and Inkscape.

    ## Optical variants

    - `talysman-app-icon.svg`: full detail, intended for 128 px and larger.
    - `talysman-app-icon-small.svg`: simplified for roughly 32–64 px.
    - `talysman-app-icon-micro.svg`: simplified for roughly 16–24 px.
    - `talysman-tray.svg`: monochrome transparent glyph for menu bars and trays.

    ## Key deliverables

    - Windows: `generated/windows/icon.ico` and `generated/windows/tray.ico`
    - macOS: `generated/macos/icon.icns`, `generated/macos/Talysman.iconset/`, and template tray PNGs
    - Linux: eight PNG sizes plus scalable SVG and tray variants
    - Web/PWA: favicon files, Apple touch icon, 192/512 icons, maskable icons and manifest
    - Editable brand files: mark, wordmark, horizontal lockup and tagline lockup

    ## macOS Icon Composer

    Apple's newer `.icon` project format is created by the macOS-only Icon Composer application. The included `Talysman.iconset/` and 1024 px master are ready to import there; the cross-platform `.icns` file is already included for Electron packaging.

    ## Electron

    See `integration/electron-builder.example.json`. Tray icons should be selected separately from the main application icon.
    """)
    (ROOT / "README.md").write_text(readme, encoding="utf-8")


if __name__ == "__main__":
    main()
