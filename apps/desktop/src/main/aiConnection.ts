import { app, safeStorage } from 'electron';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { config } from './config.js';

/** Matches ~/nixos-config/modules/home/scripts/llm-serve.toml defaults. */
const LOCAL_ENDPOINT = 'http://127.0.0.1:11434/v1/chat/completions';
const STORE_FILE = 'ai-connection.json';
const TIMEOUT_MS = 6_000;

export interface AiConnectionInput {
  url: string;
  model: string;
  apiKey?: string;
  extraHeaders?: string;
  clearApiKey?: boolean;
  clearExtraHeaders?: boolean;
}

interface AiConnection {
  endpoint: string;
  model: string;
  apiKey: string;
  headers: Record<string, string>;
}

export interface AiConnectionStatus {
  configured: boolean;
  healthy: boolean;
  url: string;
  model: string;
  hasApiKey: boolean;
  hasExtraHeaders: boolean;
  localPreset: boolean;
  error?: string;
}

interface StoredConnection {
  endpoint: string;
  model: string;
  encryptedSecrets?: string;
  secrets?: { apiKey: string; headers: Record<string, string> };
}

let connection: AiConnection | null | undefined;
let healthy = false;
let lastError: string | undefined;
let onChange: (() => void) | undefined;

export function onAiConnectionChange(callback: () => void): void {
  onChange = callback;
}

function changed(): void {
  onChange?.();
}

function connectionPath(): string {
  return join(app.getPath('userData'), STORE_FILE);
}

function normalizeEndpoint(value: string, hasSecrets: boolean): string {
  const url = new URL(value.trim());
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) {
    throw new Error('Enter an HTTP or HTTPS URL without credentials, query, or fragment.');
  }
  const loopback = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  if (hasSecrets && url.protocol !== 'https:' && !loopback) {
    throw new Error('HTTPS is required when sending credentials to a remote endpoint.');
  }
  const path = url.pathname.replace(/\/+$/, '');
  url.pathname = path.endsWith('/chat/completions') ? path : `${path}/chat/completions`;
  return url.toString();
}

function parseHeaders(raw: string): Record<string, string> {
  if (!raw.trim()) return {};
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error('Extra headers must be a JSON object.');
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('Extra headers must be a JSON object.');
  }
  const headers: Record<string, string> = {};
  for (const [name, value] of Object.entries(parsed)) {
    if (!/^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/.test(name) || typeof value !== 'string' || /[\r\n]/.test(value)) {
      throw new Error('Extra headers must have valid names and single-line string values.');
    }
    headers[name] = value;
  }
  return headers;
}

async function load(): Promise<AiConnection | null> {
  if (connection !== undefined) return connection;
  try {
    const stored = JSON.parse(await readFile(connectionPath(), 'utf8')) as StoredConnection;
    const secrets = stored.encryptedSecrets
      ? JSON.parse(safeStorage.decryptString(Buffer.from(stored.encryptedSecrets, 'base64'))) as StoredConnection['secrets']
      : stored.secrets;
    connection = {
      endpoint: normalizeEndpoint(stored.endpoint, Boolean(secrets?.apiKey || Object.keys(secrets?.headers ?? {}).length)),
      model: stored.model,
      apiKey: secrets?.apiKey ?? '',
      headers: secrets?.headers ?? {},
    };
  } catch {
    connection = config.isLocalRelease
      ? { endpoint: LOCAL_ENDPOINT, model: 'auto', apiKey: '', headers: {} }
      : null;
  }
  return connection;
}

async function persist(value: AiConnection): Promise<void> {
  const dir = app.getPath('userData');
  await mkdir(dir, { recursive: true });
  const secrets = { apiKey: value.apiKey, headers: value.headers };
  const stored: StoredConnection = {
    endpoint: value.endpoint,
    model: value.model,
    ...(safeStorage.isEncryptionAvailable()
      ? { encryptedSecrets: safeStorage.encryptString(JSON.stringify(secrets)).toString('base64') }
      : { secrets }),
  };
  // Electron's Linux basic_text backend may be unavailable; the fallback is a user-only file.
  const path = connectionPath();
  const temp = `${path}.tmp`;
  await writeFile(temp, JSON.stringify(stored), { mode: 0o600 });
  await rename(temp, path);
}

export async function getAiConnectionStatus(): Promise<AiConnectionStatus> {
  const value = await load();
  return {
    configured: value !== null,
    healthy: value !== null && healthy,
    url: value?.endpoint ?? '',
    model: value?.model ?? '',
    hasApiKey: Boolean(value?.apiKey),
    hasExtraHeaders: Boolean(value && Object.keys(value.headers).length),
    localPreset: config.isLocalRelease,
    ...(lastError ? { error: lastError } : {}),
  };
}

export function isAiConnectionHealthy(): boolean {
  return healthy;
}

export function markAiConnectionFailed(error: unknown): void {
  healthy = false;
  lastError = error instanceof Error ? error.message : 'AI request failed.';
  changed();
}

async function resolvedModel(value: AiConnection, signal: AbortSignal): Promise<string> {
  if (value.model !== 'auto') return value.model;
  const response = await fetch(value.endpoint.replace(/\/chat\/completions$/, '/models'), {
    headers: authHeaders(value),
    signal,
  });
  if (!response.ok) throw new Error(`Model discovery failed (HTTP ${response.status}). Enter a model ID manually.`);
  const payload = await response.json() as { data?: Array<{ id?: unknown }> };
  const model = payload.data?.find((item) => typeof item.id === 'string')?.id;
  if (typeof model !== 'string') throw new Error('No model was returned by /v1/models. Enter a model ID manually.');
  return model;
}

function authHeaders(value: AiConnection): Record<string, string> {
  return { ...(value.apiKey ? { Authorization: `Bearer ${value.apiKey}` } : {}), ...value.headers };
}

export async function completeAiChat(
  messages: Array<{ role: 'system' | 'user'; content: string }>,
  timeoutMs = TIMEOUT_MS,
): Promise<string> {
  try {
    const value = await load();
    if (!value) throw new Error('Set up an AI connection in Settings first.');
    const signal = AbortSignal.timeout(timeoutMs);
    const model = await resolvedModel(value, signal);
    const response = await fetch(value.endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeaders(value) },
      body: JSON.stringify({
        model, messages, stream: false,
        ...(value.endpoint === LOCAL_ENDPOINT ? { chat_template_kwargs: { enable_thinking: false } } : {}),
      }),
      signal,
    });
    if (!response.ok) throw new Error(`AI endpoint returned HTTP ${response.status}.`);
    const payload = await response.json() as { choices?: Array<{ message?: { content?: unknown } }> };
    const content = payload.choices?.[0]?.message?.content;
    if (typeof content !== 'string' || !content.trim()) throw new Error('AI endpoint returned no assistant text.');
    return content.trim();
  } catch (error) {
    markAiConnectionFailed(error);
    throw error;
  }
}

export async function testAiConnection(input?: AiConnectionInput): Promise<AiConnectionStatus> {
  try {
    if (input) {
      const previous = await load();
      const apiKey = input.clearApiKey ? '' : input.apiKey?.trim() || previous?.apiKey || '';
      const headers = input.clearExtraHeaders ? {} : input.extraHeaders?.trim()
        ? parseHeaders(input.extraHeaders)
        : previous?.headers ?? {};
      const candidate: AiConnection = {
        endpoint: normalizeEndpoint(input.url, Boolean(apiKey || Object.keys(headers).length)),
        model: input.model.trim(),
        apiKey,
        headers,
      };
      if (!candidate.model) throw new Error('Enter a model ID, or use auto to discover one.');
      await persist(candidate);
      connection = candidate;
    }
    healthy = false;
    changed();
    const response = await completeAiChat([{ role: 'user', content: 'Reply briefly to confirm this connection works.' }]);
    if (!response) throw new Error('AI endpoint returned an empty response.');
    healthy = true;
    lastError = undefined;
  } catch (error) {
    markAiConnectionFailed(error);
  }
  changed();
  return getAiConnectionStatus();
}
