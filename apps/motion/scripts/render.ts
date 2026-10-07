/**
 * Renders the search pages' demo videos.
 *
 *   pnpm --filter @talysman/motion render                 # all of them
 *   pnpm --filter @talysman/motion render cold-turkey-alternative brick-for-computer
 *   pnpm --filter @talysman/motion render --scale=1       # faster draft (no supersampling)
 *
 * Each composition renders at 2x (3840x2160) and is downscaled to 1080p, as the hero demo is —
 * supersampling keeps the app's hairline borders and small mono type from crawling. Encodes
 * match scripts/record-demo.mjs: H.264 for everyone, VP9 for browsers that take it, and a JPEG
 * poster from the frame that carries the idea.
 *
 * Output → apps/web/public/media/demos/<slug>.{mp4,webm,jpg}, plus
 *          apps/web/src/lib/content/intent/demo-videos.json, which the pages read.
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { bundle } from '@remotion/bundler';
import { getCompositions, renderMedia } from '@remotion/renderer';
import { stageAssets } from './assets';
import { webpackOverride } from '../src/webpack';

process.env.TZ = 'UTC';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '../../..');
const WORK = resolve(HERE, '../out');
const OUT = resolve(ROOT, 'apps/web/public/media/demos');
const MANIFEST = resolve(ROOT, 'apps/web/src/lib/content/intent/demo-videos.json');

/** What src/Root.tsx passes each demo composition as defaultProps. */
type DemoMeta = { description: string; poster: number };

type Entry = {
  description: string;
  /** ISO 8601 duration, for VideoObject. */
  duration: string;
  seconds: number;
  uploadDate: string;
  width: number;
  height: number;
};

const args = process.argv.slice(2);
const scale = Number(args.find((a) => a.startsWith('--scale='))?.split('=')[1] ?? 2);
const only = args.filter((a) => !a.startsWith('--'));

function ffmpeg(...params: string[]) {
  execFileSync('ffmpeg', ['-loglevel', 'error', '-y', ...params], { stdio: 'inherit' });
}

async function main() {
  stageAssets();
  mkdirSync(WORK, { recursive: true });
  mkdirSync(OUT, { recursive: true });

  console.log('bundling…');
  const serveUrl = await bundle({ entryPoint: resolve(HERE, '../src/index.ts'), webpackOverride, publicDir: resolve(HERE, '../public') });

  // The demos live in the bundle (they import the desktop renderer, CSS and all), so their
  // metadata comes back through the compositions they register — see src/Root.tsx.
  const all = (await getCompositions(serveUrl)).filter((composition) => composition.id !== 'gallery');
  const demos = only.length > 0 ? all.filter((d) => only.includes(d.id)) : all;
  const missing = only.filter((slug) => !all.some((d) => d.id === slug));
  if (missing.length > 0) throw new Error(`no demo for: ${missing.join(', ')}`);

  const manifest: Record<string, Entry> = (() => {
    try {
      return JSON.parse(readFileSync(MANIFEST, 'utf8')) as Record<string, Entry>;
    } catch {
      return {};
    }
  })();

  for (const composition of demos) {
    const meta = composition.defaultProps as DemoMeta;
    const demo = { slug: composition.id, duration: composition.durationInFrames / composition.fps, ...meta };
    const raw = join(WORK, `${demo.slug}.mp4`);
    console.log(`\n▸ ${demo.slug} (${demo.duration}s)`);
    let last = -1;
    await renderMedia({
      serveUrl,
      composition,
      codec: 'h264',
      crf: 12,
      scale,
      outputLocation: raw,
      envVariables: { TZ: 'UTC' },
      chromiumOptions: { gl: 'angle' },
      onProgress: ({ progress }) => {
        const pct = Math.floor(progress * 10) * 10;
        if (pct !== last) process.stdout.write(`${pct}% `);
        last = pct;
      },
    });

    const vf = ['-vf', 'scale=1920:1080:flags=lanczos', '-r', '30', '-an'];
    console.log('\n  encoding…');
    ffmpeg('-i', raw, ...vf, '-c:v', 'libx264', '-profile:v', 'high', '-crf', '20', '-preset', 'slow', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', join(OUT, `${demo.slug}.mp4`));
    ffmpeg('-i', raw, ...vf, '-c:v', 'libvpx-vp9', '-crf', '34', '-b:v', '0', '-row-mt', '1', join(OUT, `${demo.slug}.webm`));
    ffmpeg('-ss', String(demo.poster), '-i', raw, '-frames:v', '1', '-vf', 'scale=1920:1080:flags=lanczos', '-q:v', '4', join(OUT, `${demo.slug}.jpg`));

    manifest[demo.slug] = {
      description: demo.description,
      duration: `PT${Math.round(demo.duration)}S`,
      seconds: demo.duration,
      uploadDate: new Date().toISOString().slice(0, 10),
      width: 1920,
      height: 1080,
    };
    // Written after every video, so an interrupted run keeps what it finished.
    const sorted = Object.fromEntries(Object.entries(manifest).sort(([a], [b]) => a.localeCompare(b)));
    writeFileSync(MANIFEST, `${JSON.stringify(sorted, null, 2)}\n`);
    console.log(`  ✓ ${demo.slug}`);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
