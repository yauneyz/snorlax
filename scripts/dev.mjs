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

let setupChild;
let shuttingDown = false;

function announce(message) {
  console.log(`\n[dev] ${message}`);
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

  await assertPortAvailable(3000);

  announce('generating local environment files');
  await run(pnpm, ['sync:env']);

  announce('starting local Supabase services');
  await run('supabase', ['start'], { cwd: web });

  announce('reading Stripe CLI webhook secret');
  const secretOutput = await run(stripe, ['listen', '--print-secret'], { capture: true });
  const webhookSecret = secretOutput.match(/whsec_[A-Za-z0-9]+/)?.[0];
  if (!webhookSecret) {
    throw new Error(
      'Stripe CLI did not return a webhook signing secret. Run `stripe login` and try again.',
    );
  }

  startProcess('Stripe webhook listener', stripe, ['listen', '--forward-to', webhookUrl]);

  const webEnv = {
    ...process.env,
    STRIPE_WEBHOOK_SECRET: webhookSecret,
  };
  const webProcess = startProcess(
    'web app',
    pnpm,
    ['--filter', '@talysman/web', 'exec', 'next', 'dev', '--port', '3000'],
    webEnv,
  );

  announce(`waiting for ${webUrl}`);
  await waitForWeb(webProcess);

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
