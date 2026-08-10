#!/usr/bin/env node
/**
 * Start the complete local development stack from one terminal:
 *   - Supabase's Docker services (left running between dev sessions)
 *   - Stripe webhook forwarding
 *   - the Next.js web app
 *   - the Electron desktop app
 *
 * Ctrl+C stops the three attached processes. Run `pnpm dev:down` when the
 * persistent Supabase stack should also be stopped.
 *
 * `--dummy` is for a machine that does not have the real secrets: every step that depends on
 * credentials degrades to a placeholder and a warning instead of aborting the stack. Without
 * it the startup sequence keeps failing loudly, which is what a configured machine wants.
 */

import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

import {
  assertPortAvailable,
  isProcessRunning,
  processRecord,
  signalProcess,
  waitForProcesses,
} from './lib/dev-processes.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const web = resolve(root, 'apps/web');
const pnpm = process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm';
const stripe = process.platform === 'win32' ? 'stripe.exe' : 'stripe';
const webhookUrl = 'http://localhost:3000/api/stripe/webhook';
const webUrl = 'http://localhost:3000';
const children = new Map();

// Any signature-checked webhook delivery fails against this, which is the honest outcome when
// the Stripe CLI cannot hand out the real one.
const DUMMY_WEBHOOK_SECRET = 'whsec_dummydummydummydummydummydummydummy';
const dummyCredentials = process.argv.includes('--dummy');

let setupChild;
let shuttingDown = false;

function announce(message) {
  console.log(`\n[dev] ${message}`);
}

function warnDummy(message) {
  console.warn(`[dev] [dummy] ${message}`);
}

/**
 * Run a credential-dependent setup step. In `--dummy` mode its failure is reported and the
 * stack continues; otherwise the error propagates and `pnpm dev` stops as it always has.
 */
async function attempt(label, step) {
  try {
    return { ok: true, value: await step() };
  } catch (error) {
    if (!dummyCredentials) throw error;
    warnDummy(`${label} failed: ${error.message.split('\n')[0]}`);
    return { ok: false, value: undefined };
  }
}

function run(command, args, options = {}) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd ?? root,
      env: options.env ?? process.env,
      stdio: options.capture ? ['ignore', 'pipe', 'pipe'] : 'inherit',
      shell: false,
    });
    setupChild = child;

    let output = '';
    if (options.capture) {
      child.stdout.on('data', (chunk) => {
        output += chunk;
      });
      child.stderr.on('data', (chunk) => {
        output += chunk;
      });
    }

    child.once('error', (error) => {
      setupChild = undefined;
      reject(new Error(`Could not run ${command}: ${error.message}`));
    });
    child.once('exit', (code, signal) => {
      setupChild = undefined;
      if (code === 0) {
        resolvePromise(output);
        return;
      }

      const detail = signal ? `signal ${signal}` : `exit code ${code}`;
      const captured = output.trim();
      reject(
        new Error(
          `${command} ${args.join(' ')} failed with ${detail}${captured ? `\n${captured}` : ''}`,
        ),
      );
    });
  });
}

function startProcess(name, command, args, env = process.env) {
  announce(`starting ${name}`);
  const child = spawn(command, args, {
    cwd: root,
    env,
    stdio: 'inherit',
    shell: false,
    detached: process.platform !== 'win32',
  });
  const record = processRecord(name, child);
  children.set(name, record);

  child.once('error', (error) => {
    if (!shuttingDown) {
      console.error(`[dev] ${name} failed to start: ${error.message}`);
      void shutdown(1);
    }
  });
  child.once('exit', (code, signal) => {
    if (!shuttingDown) {
      const detail = signal ? `signal ${signal}` : `exit code ${code ?? 1}`;
      console.error(`\n[dev] ${name} stopped unexpectedly (${detail})`);
      void shutdown(code ?? 1);
    }
  });

  return child;
}

async function shutdown(exitCode = 0) {
  if (shuttingDown) return;
  shuttingDown = true;
  announce('stopping attached processes');

  if (setupChild) setupChild.kill('SIGTERM');

  const running = [...children.values()];
  const gracefulSignal = process.platform === 'win32' ? 'SIGTERM' : 'SIGINT';
  for (const record of running.reverse()) signalProcess(record, gracefulSignal);

  await waitForProcesses(running, 4_000);

  const stubborn = running.filter((record) => isProcessRunning(record));
  for (const record of stubborn) signalProcess(record, 'SIGKILL');
  await waitForProcesses(stubborn, 1_000);
  process.exit(exitCode);
}

function waitForWeb(child, timeoutMs = 90_000) {
  return new Promise((resolvePromise, reject) => {
    const startedAt = Date.now();
    let timer;

    const onExit = (code, signal) => {
      clearTimeout(timer);
      const detail = signal ? `signal ${signal}` : `exit code ${code ?? 1}`;
      reject(new Error(`web app stopped before becoming ready (${detail})`));
    };

    const probe = async () => {
      if (shuttingDown) return;

      try {
        const response = await fetch(webUrl, { redirect: 'manual' });
        if (response.status < 500) {
          child.off('exit', onExit);
          resolvePromise();
          return;
        }
      } catch {
        // The server is still compiling or has not bound its port yet.
      }

      if (Date.now() - startedAt >= timeoutMs) {
        child.off('exit', onExit);
        reject(new Error(`timed out waiting for ${webUrl}`));
        return;
      }
      timer = setTimeout(probe, 500);
    };

    child.once('exit', onExit);
    void probe();
  });
}

async function main() {
  process.env.APP_ENV ??= 'development';
  // The normal development workflow is a second control client for the installed daemon. This
  // gives it real USB discovery and lets the already-installed browser extensions observe dev
  // focus changes. `pnpm dev:mock` overrides both values for UI-only work and E2E-style testing.
  process.env.TALYSMAN_PIPE ??= 'talysman';
  process.env.TALYSMAN_USE_MOCK_SERVICE ??= 'false';

  if (dummyCredentials) {
    // Inherited by the nested `pnpm sync:env`, which does the same downgrade for each
    // credential it cannot read (scripts/sync-env.ts).
    process.env.TALYSMAN_DUMMY_CREDENTIALS = 'true';
    announce('running with --dummy: missing credentials become placeholders, not failures');
  }

  await assertPortAvailable(3000);

  announce('generating local environment files');
  await run(pnpm, ['sync:env']);

  announce('starting local Supabase services');
  await attempt('local Supabase services', () => run('supabase', ['start'], { cwd: web }));

  announce('reading Stripe CLI webhook secret');
  const secret = await attempt('reading the Stripe CLI webhook secret', async () => {
    const secretOutput = await run(stripe, ['listen', '--print-secret'], { capture: true });
    const webhookSecret = secretOutput.match(/whsec_[A-Za-z0-9]+/)?.[0];
    if (!webhookSecret) {
      throw new Error(
        'Stripe CLI did not return a webhook signing secret. Run `stripe login` and try again.',
      );
    }
    return webhookSecret;
  });

  if (secret.ok) {
    startProcess('Stripe webhook listener', stripe, ['listen', '--forward-to', webhookUrl]);
  } else {
    warnDummy('skipping the webhook listener; Stripe events will not reach the web app');
  }

  const webEnv = {
    ...process.env,
    STRIPE_WEBHOOK_SECRET: secret.value ?? DUMMY_WEBHOOK_SECRET,
  };
  const webProcess = startProcess(
    'web app',
    pnpm,
    ['--filter', '@talysman/web', 'exec', 'next', 'dev', '--port', '3000'],
    webEnv,
  );

  announce(`waiting for ${webUrl}`);
  await waitForWeb(webProcess);

  announce(
    process.env.TALYSMAN_USE_MOCK_SERVICE === 'true'
      ? 'desktop will use the in-process mock service'
      : 'desktop will share the installed Talysman service',
  );
  startProcess('desktop app', pnpm, ['--filter', '@talysman/desktop', 'dev']);
  announce('stack is ready; press Ctrl+C to stop Stripe, Next, and Electron');
  console.log('[dev] Supabase remains running; use `pnpm dev:down` to stop it.');
}

function requestShutdown() {
  if (shuttingDown) {
    // `pnpm dev` can forward the terminal signal after Node already received
    // it directly. Do not let that second signal take Node's default exit path
    // before the asynchronous graceful-shutdown timer has finished.
    for (const record of children.values()) signalProcess(record, 'SIGKILL');
    return;
  }

  void shutdown(0);
}

process.on('SIGINT', requestShutdown);
process.on('SIGTERM', requestShutdown);
process.on('SIGHUP', requestShutdown);
process.once('exit', () => {
  // Synchronous backstop for a second signal or an outer package runner exiting
  // before the graceful-shutdown timer completes.
  for (const record of children.values()) signalProcess(record, 'SIGKILL');
});

main().catch((error) => {
  console.error(`\n[dev] ${error.message}`);
  void shutdown(1);
});
