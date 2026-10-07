import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { enableTailwind } from '@remotion/tailwind';
import type { WebpackOverrideFn } from '@remotion/bundler';

/** The workspace root. Found from the cwd: Remotion compiles this file somewhere else. */
function workspaceRoot(from = process.cwd()): string {
  if (existsSync(resolve(from, 'pnpm-workspace.yaml'))) return from;
  const up = dirname(from);
  if (up === from) throw new Error('Run the motion scripts from inside the repository.');
  return workspaceRoot(up);
}

const ROOT = workspaceRoot();

/**
 * Shared by the studio (remotion.config.ts) and the render script, so both bundle identically.
 *
 * - Tailwind with the desktop app's config, for the real renderer components.
 * - The desktop source imports `./x.js` for `./x.ts`, as TypeScript's bundler resolution allows.
 * - Workspace packages resolve to their TypeScript source, as in electron-vite.
 */
export const webpackOverride: WebpackOverrideFn = (config) => {
  const withTailwind = enableTailwind(config, { configLocation: resolve(ROOT, 'apps/motion/tailwind.config.js') });
  return {
    ...withTailwind,
    resolve: {
      ...withTailwind.resolve,
      extensionAlias: { '.js': ['.ts', '.tsx', '.js'] },
      alias: {
        ...(withTailwind.resolve?.alias as Record<string, string> | undefined),
        '@talysman/shared': resolve(ROOT, 'packages/shared/src/index.ts'),
        '@talysman/product': resolve(ROOT, 'packages/product/src/index.ts'),
        '@talysman/core/browser': resolve(ROOT, 'packages/core/src/browser.ts'),
        '@talysman/core$': resolve(ROOT, 'packages/core/src/index.ts'),
      },
    },
  };
};
