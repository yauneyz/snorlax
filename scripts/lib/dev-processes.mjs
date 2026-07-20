import { createServer } from 'node:net';

export function processRecord(name, child, platform = process.platform) {
  return {
    name,
    child,
    processGroupId: platform === 'win32' ? undefined : child.pid,
  };
}

export function isProcessRunning(record, platform = process.platform) {
  if (platform === 'win32') {
    return Boolean(
      record.child.pid && record.child.exitCode === null && record.child.signalCode === null,
    );
  }

  if (!record.processGroupId) return false;

  try {
    process.kill(-record.processGroupId, 0);
    return true;
  } catch (error) {
    if (error.code === 'ESRCH') return false;
    if (error.code === 'EPERM') return true;
    throw error;
  }
}

export function signalProcess(record, signal, platform = process.platform) {
  if (!isProcessRunning(record, platform)) return;

  try {
    if (platform === 'win32') {
      record.child.kill(signal);
    } else {
      // The group leader (usually pnpm) can exit before descendants such as
      // Next or Electron. Keep addressing the group even after that happens.
      process.kill(-record.processGroupId, signal);
    }
  } catch (error) {
    if (error.code !== 'ESRCH') throw error;
  }
}

export async function waitForProcesses(records, timeoutMs) {
  const deadline = Date.now() + timeoutMs;

  while (records.some((record) => isProcessRunning(record))) {
    if (Date.now() >= deadline) return false;
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 50));
  }

  return true;
}

export function assertPortAvailable(port, serverFactory = createServer) {
  return new Promise((resolvePromise, reject) => {
    const server = serverFactory();
    server.unref();

    server.once('error', (error) => {
      if (error.code === 'EADDRINUSE') {
        reject(
          new Error(
            `Port ${port} is already in use. Another dev stack may still be running; stop it before running \`pnpm dev\` again.`,
          ),
        );
        return;
      }
      reject(error);
    });

    server.listen({ host: '::', port }, () => {
      server.close(resolvePromise);
    });
  });
}
