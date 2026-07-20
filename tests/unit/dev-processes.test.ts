import { EventEmitter } from 'node:events';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  assertPortAvailable,
  isProcessRunning,
  processRecord,
  signalProcess,
  // eslint-disable-next-line @typescript-eslint/ban-ts-comment
  // @ts-ignore — untyped .mjs module shared with the dev script
} from '../../scripts/lib/dev-processes.mjs';

afterEach(() => {
  vi.restoreAllMocks();
});

describe('dev process groups', () => {
  it('signals Unix descendants after the pnpm group leader has exited', () => {
    const child = {
      pid: 1234,
      exitCode: 0,
      signalCode: null,
      kill: vi.fn(),
    };
    const record = processRecord('web app', child, 'linux');
    const kill = vi.spyOn(process, 'kill').mockReturnValue(true);

    expect(isProcessRunning(record, 'linux')).toBe(true);
    signalProcess(record, 'SIGKILL', 'linux');

    expect(kill).toHaveBeenNthCalledWith(1, -1234, 0);
    expect(kill).toHaveBeenNthCalledWith(2, -1234, 0);
    expect(kill).toHaveBeenNthCalledWith(3, -1234, 'SIGKILL');
    expect(child.kill).not.toHaveBeenCalled();
  });
});

describe('dev port guard', () => {
  it('rejects a port that is already bound', async () => {
    const server = new EventEmitter() as EventEmitter & {
      unref: () => void;
      listen: () => void;
    };
    server.unref = vi.fn();
    server.listen = vi.fn(() => {
      const error = Object.assign(new Error('address in use'), { code: 'EADDRINUSE' });
      server.emit('error', error);
    });

    await expect(assertPortAvailable(3000, () => server)).rejects.toThrow(
      'Port 3000 is already in use',
    );
  });
});
