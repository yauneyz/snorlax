/**
 * Contact-sheet stills for reviewing demos without a full render.
 *
 *   pnpm --filter @talysman/motion stills <outDir> [times] [slug…]
 *
 * `times` is comma-separated seconds, or `poster` (the default) for each demo's poster frame.
 * Stills are half size.
 */
import { resolve } from 'node:path';
import { bundle } from '@remotion/bundler';
import { getCompositions, renderStill } from '@remotion/renderer';
import { stageAssets } from './assets';
import { webpackOverride } from '../src/webpack';

process.env.TZ = 'UTC';

const [outDir, timeList = 'poster', ...only] = process.argv.slice(2);
if (!outDir) throw new Error('usage: stills <outDir> [times] [slug…]');

async function main() {
  stageAssets();
  const here = resolve(import.meta.dirname, '..');
  const serveUrl = await bundle({ entryPoint: resolve(here, 'src/index.ts'), webpackOverride, publicDir: resolve(here, 'public') });
  for (const composition of await getCompositions(serveUrl)) {
    if (composition.id === 'gallery' || (only.length > 0 && !only.includes(composition.id))) continue;
    for (const time of timeList.split(',')) {
      const seconds = time === 'poster' ? (composition.defaultProps as { poster: number }).poster : Number(time);
      await renderStill({
        serveUrl,
        composition,
        frame: Math.min(composition.durationInFrames - 1, Math.round(seconds * composition.fps)),
        output: resolve(outDir!, `${composition.id}-${time}.png`),
        scale: 0.5,
      });
    }
    console.log(`  ✓ ${composition.id}`);
  }
}

main().then(
  () => process.exit(0),
  (error) => {
    console.error(error);
    process.exit(1);
  },
);
