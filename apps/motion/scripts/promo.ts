/**
 * Renders the 4:5 feed promos, with sound.
 *
 *   pnpm --filter @talysman/motion promo                 # both cuts
 *   pnpm --filter @talysman/motion promo promo-short     # one
 *   pnpm --filter @talysman/motion promo --scale=1       # faster draft
 *
 * Picture renders at 2x and is downscaled, as the demos are. The sound effects are synthesized
 * here with ffmpeg (no licensed audio in the repo) and laid on the cues in src/promo/timeline.ts,
 * the same beats the picture hits. Feeds autoplay muted, so nothing depends on the sound.
 *
 * Output → apps/motion/out/promo/<id>.mp4 and <id>.jpg (thumbnail).
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { bundle } from '@remotion/bundler';
import { getCompositions, renderMedia } from '@remotion/renderer';
import { stageAssets } from './assets';
import { webpackOverride } from '../src/webpack';
import { HERO_CUES, SHORT_CUES, type Cue, type Sfx } from '../src/promo/timeline';

process.env.TZ = 'UTC';

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = resolve(HERE, '../out/promo');
const SFX_DIR = join(OUT, 'sfx');

const CUTS: Record<string, { cues: Cue[]; thumbnail: number }> = {
  'promo-hero': { cues: HERO_CUES, thumbnail: 3.4 },
  'promo-short': { cues: SHORT_CUES, thumbnail: 0.9 },
};

const args = process.argv.slice(2);
const scale = Number(args.find((a) => a.startsWith('--scale='))?.split('=')[1] ?? 2);
const only = args.filter((a) => !a.startsWith('--'));

function ffmpeg(...params: string[]) {
  execFileSync('ffmpeg', ['-loglevel', 'error', '-y', ...params], { stdio: 'inherit' });
}

/** Each effect as an ffmpeg source + filter chain: [lavfi source, duration, filters]. */
const RECIPES: Record<Sfx, [string, string]> = {
  // Toggle: a dry, bright click.
  tick: ['aevalsrc=(random(0)*2-1)*exp(-t*220)*0.7+0.3*sin(2*PI*2400*t)*exp(-t*160):d=0.05', 'highpass=f=1500'],
  // Kick with a pitch drop: the camera-shake hits.
  thump: ['aevalsrc=0.95*sin(2*PI*(48+70*exp(-t*28))*t)*exp(-t*6.5):d=0.7', 'lowpass=f=900'],
  // Kick plus a noise crack, for slammed words.
  slam: ['aevalsrc=0.85*sin(2*PI*(45+95*exp(-t*26))*t)*exp(-t*6)+0.28*(random(0)*2-1)*exp(-t*32):d=0.55', 'lowpass=f=5000'],
  whoosh: ['anoisesrc=c=pink:d=0.5:a=0.5', 'bandpass=f=1200:w=1800,afade=t=in:d=0.32:curve=exp,afade=t=out:st=0.32:d=0.18'],
  // USB plug: two metal clicks, close together.
  plug: [
    'aevalsrc=(random(0)*2-1)*exp(-t*140)*0.8+0.45*sin(2*PI*3300*t)*exp(-t*70)+gte(t\\,0.05)*((random(1)*2-1)*exp(-(t-0.05)*170)*0.7+0.4*sin(2*PI*4100*(t-0.05))*exp(-(t-0.05)*80)):d=0.2',
    'highpass=f=700',
  ],
  unplug: ['aevalsrc=(random(0)*2-1)*exp(-t*120)*0.6+0.35*sin(2*PI*2200*t)*exp(-t*60):d=0.15', 'highpass=f=500'],
  stamp: ['aevalsrc=0.9*sin(2*PI*(62+80*exp(-t*30))*t)*exp(-t*9)+0.38*(random(0)*2-1)*exp(-t*24):d=0.45', 'lowpass=f=3500'],
  // Two short error buzzes.
  buzz: ['aevalsrc=0.22*(sin(2*PI*98*t)+0.5*sin(2*PI*196*t)+0.3*sin(2*PI*294*t))*(lt(t\\,0.11)+gte(t\\,0.16)*lt(t\\,0.3)):d=0.32', 'lowpass=f=1600,afade=t=out:st=0.27:d=0.05'],
  // Major-triad chime with a tail, for the logo.
  chime: [
    'aevalsrc=0.16*(sin(2*PI*523.25*t)+0.8*sin(2*PI*659.25*t)+0.7*sin(2*PI*783.99*t)+0.35*sin(2*PI*1046.5*t))*exp(-t*1.6)*(1-exp(-t*90)):d=2.6',
    'aecho=0.8:0.6:70|140:0.3|0.18',
  ],
  riser: ['anoisesrc=c=pink:d=1.5:a=0.35', 'highpass=f=400,afade=t=in:d=1.45:curve=exp,afade=t=out:st=1.45:d=0.05'],
};

function synthesize() {
  mkdirSync(SFX_DIR, { recursive: true });
  for (const [name, [source, filters]] of Object.entries(RECIPES)) {
    ffmpeg('-f', 'lavfi', '-i', source, '-af', `${filters},aformat=sample_rates=48000:channel_layouts=stereo`, join(SFX_DIR, `${name}.wav`));
  }
}

/** Lays every cue onto one track the length of the cut. */
function mix(cues: Cue[], seconds: number, output: string) {
  const inputs = cues.flatMap((cue) => ['-i', join(SFX_DIR, `${cue.sfx}.wav`)]);
  const chains = cues.map((cue, i) => {
    const ms = Math.max(0, Math.round(cue.at * 1000));
    return `[${i}]adelay=${ms}|${ms},volume=${cue.gain ?? 1}[a${i}]`;
  });
  const graph = `${chains.join(';')};${cues.map((_, i) => `[a${i}]`).join('')}amix=inputs=${cues.length}:normalize=0,alimiter=limit=0.79,apad,atrim=0:${seconds}[out]`;
  ffmpeg(...inputs, '-filter_complex', graph, '-map', '[out]', '-ar', '48000', output);
}

async function main() {
  stageAssets();
  mkdirSync(OUT, { recursive: true });
  console.log('synthesizing sound…');
  synthesize();

  console.log('bundling…');
  const serveUrl = await bundle({ entryPoint: resolve(HERE, '../src/index.ts'), webpackOverride, publicDir: resolve(HERE, '../public') });
  const all = (await getCompositions(serveUrl)).filter((composition) => composition.id in CUTS);
  const cuts = only.length > 0 ? all.filter((c) => only.includes(c.id)) : all;
  const missing = only.filter((id) => !all.some((c) => c.id === id));
  if (missing.length > 0) throw new Error(`no promo: ${missing.join(', ')}`);

  for (const composition of cuts) {
    const { cues, thumbnail } = CUTS[composition.id]!;
    const seconds = composition.durationInFrames / composition.fps;
    const raw = join(OUT, `${composition.id}.raw.mp4`);
    const audio = join(OUT, `${composition.id}.wav`);
    console.log(`\n▸ ${composition.id} (${seconds}s)`);
    let last = -1;
    await renderMedia({
      serveUrl,
      composition,
      codec: 'h264',
      crf: 12,
      scale,
      muted: true,
      outputLocation: raw,
      envVariables: { TZ: 'UTC' },
      chromiumOptions: { gl: 'angle' },
      onProgress: ({ progress }) => {
        const pct = Math.floor(progress * 10) * 10;
        if (pct !== last) process.stdout.write(`${pct}% `);
        last = pct;
      },
    });

    console.log('\n  mixing + encoding…');
    mix(cues, seconds, audio);
    const size = `scale=${composition.width}:${composition.height}:flags=lanczos`;
    ffmpeg(
      '-i', raw, '-i', audio,
      '-map', '0:v', '-map', '1:a',
      '-vf', size, '-r', '30',
      '-c:v', 'libx264', '-profile:v', 'high', '-crf', '17', '-preset', 'slow', '-pix_fmt', 'yuv420p',
      '-c:a', 'aac', '-b:a', '192k',
      '-movflags', '+faststart', '-shortest',
      join(OUT, `${composition.id}.mp4`),
    );
    ffmpeg('-ss', String(thumbnail), '-i', raw, '-frames:v', '1', '-vf', size, '-q:v', '2', join(OUT, `${composition.id}.jpg`));
    console.log(`  ✓ ${join(OUT, `${composition.id}.mp4`)}`);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
