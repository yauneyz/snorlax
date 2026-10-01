import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const state = vi.hoisted(() => ({ directory: '' }));

vi.mock('electron', () => ({
  app: { getPath: () => state.directory },
  safeStorage: {
    isEncryptionAvailable: () => true,
    encryptString: (value: string) => Buffer.from(`sealed:${value}`),
    decryptString: (value: Buffer) => value.toString().slice('sealed:'.length),
  },
}));

beforeEach(async () => {
  state.directory = await mkdtemp(join(tmpdir(), 'talysman-ai-'));
  vi.resetModules();
});

afterEach(async () => {
  vi.unstubAllGlobals();
  await rm(state.directory, { recursive: true, force: true });
});

describe('AI connection', () => {
  it('tests a real chat completion, stores secrets encrypted, and turns red after an error', async () => {
    const fetchMock = vi.fn(async (_url: string, _options: RequestInit) =>
      new Response(JSON.stringify({ choices: [{ message: { content: 'Connection works.' } }] }), { status: 200 }),
    );
    vi.stubGlobal('fetch', fetchMock);
    const ai = await import('../../../apps/desktop/src/main/aiConnection.js');

    const status = await ai.testAiConnection({
      url: 'https://example.com/v1', model: 'test-model', apiKey: 'private-key',
      extraHeaders: '{"X-Test-Key":"another-secret"}',
    });
    expect(status.healthy).toBe(true);
    expect(status.hasApiKey).toBe(true);
    expect(fetchMock).toHaveBeenCalledWith('https://example.com/v1/chat/completions', expect.objectContaining({
      headers: expect.objectContaining({ Authorization: 'Bearer private-key', 'X-Test-Key': 'another-secret' }),
    }));
    const saved = await readFile(join(state.directory, 'ai-connection.json'), 'utf8');
    expect(saved).not.toContain('private-key');
    expect(saved).not.toContain('another-secret');

    vi.stubGlobal('fetch', vi.fn(async () => new Response('', { status: 401 })));
    await expect(ai.completeAiChat([{ role: 'user', content: 'Hello' }])).rejects.toThrow('HTTP 401');
    expect((await ai.getAiConnectionStatus()).healthy).toBe(false);
    expect((await ai.getAiConnectionStatus()).error).toContain('401');
    vi.stubGlobal('fetch', fetchMock);
    expect((await ai.testAiConnection()).healthy).toBe(true);
  });

  it('discovers the served model when model is auto', async () => {
    const fetchMock = vi.fn(async (url: string, _options?: RequestInit) => url.endsWith('/models')
      ? new Response(JSON.stringify({ data: [{ id: 'qwen3.5-9b' }] }), { status: 200 })
      : new Response(JSON.stringify({ choices: [{ message: { content: 'Ready.' } }] }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    const ai = await import('../../../apps/desktop/src/main/aiConnection.js');
    const status = await ai.testAiConnection({ url: 'http://127.0.0.1:11434/v1', model: 'auto' });
    expect(status.healthy).toBe(true);
    expect(fetchMock.mock.calls[0]?.[0]).toBe('http://127.0.0.1:11434/v1/models');
    const request = fetchMock.mock.calls[1]?.[1] as RequestInit;
    expect(JSON.parse(request.body as string)).toMatchObject({ model: 'qwen3.5-9b' });
  });
});
