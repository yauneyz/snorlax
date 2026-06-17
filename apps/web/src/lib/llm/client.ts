import "server-only";

import { config } from "@/lib/config";

export const DEFAULT_OPENAI_ENDPOINT = "https://api.openai.com/v1/chat/completions";
export const DEFAULT_LOCAL_LLM_ENDPOINT = "http://127.0.0.1:11434/v1/chat/completions";
export const DEFAULT_LOCAL_LLM_MODEL = "qwen3-14b-awq";

export type LlmProvider = typeof config.llm.provider;

export type LlmMessageRole = "system" | "user" | "assistant";

export interface LlmMessage {
  role: LlmMessageRole;
  content: string;
}

export interface LlmCompletionOptions {
  model?: string;
  temperature?: number;
  maxTokens?: number;
  signal?: AbortSignal;
}

export interface LlmClientOptions {
  provider?: LlmProvider;
  endpoint?: string;
  model?: string;
  apiKey?: string;
  organization?: string;
  fetchImpl?: typeof fetch;
}

export interface LlmClient {
  complete(prompt: string, options?: LlmCompletionOptions): Promise<string>;
  completeChat(messages: LlmMessage[], options?: LlmCompletionOptions): Promise<string>;
}

export function createLlmClient(options: LlmClientOptions = {}): LlmClient {
  return new OpenAICompatibleLlmClient(resolveLlmClientConfig(options));
}

export async function completeLlm(prompt: string, options?: LlmCompletionOptions): Promise<string> {
  return createLlmClient().complete(prompt, options);
}

interface ResolvedLlmClientConfig {
  provider: LlmProvider;
  endpoint: string;
  model: string;
  apiKey: string;
  organization: string;
  fetchImpl: typeof fetch;
}

class OpenAICompatibleLlmClient implements LlmClient {
  constructor(private readonly clientConfig: ResolvedLlmClientConfig) {}

  complete(prompt: string, options: LlmCompletionOptions = {}): Promise<string> {
    return this.completeChat([{ role: "user", content: prompt }], options);
  }

  async completeChat(messages: LlmMessage[], options: LlmCompletionOptions = {}): Promise<string> {
    const response = await this.clientConfig.fetchImpl(this.clientConfig.endpoint, {
      method: "POST",
      headers: this.headers(),
      signal: options.signal,
      body: JSON.stringify({
        model: options.model ?? this.clientConfig.model,
        messages,
        temperature: options.temperature ?? 0.7,
        stream: false,
        ...(options.maxTokens === undefined ? {} : { max_tokens: options.maxTokens }),
      }),
    });

    if (!response.ok) {
      const body = await response.text();
      throw new Error(`LLM request failed with ${response.status}: ${body.slice(0, 400)}`);
    }

    const payload = (await response.json()) as Record<string, unknown>;
    const content = extractAssistantContent(payload);
    if (!content) {
      throw new Error(`LLM response did not contain assistant content: ${JSON.stringify(payload)}`);
    }

    return content.trim();
  }

  private headers(): Record<string, string> {
    return {
      "Content-Type": "application/json",
      ...(this.clientConfig.apiKey ? { Authorization: `Bearer ${this.clientConfig.apiKey}` } : {}),
      ...(this.clientConfig.provider === "openai" && this.clientConfig.organization
        ? { "OpenAI-Organization": this.clientConfig.organization }
        : {}),
    };
  }
}

function resolveLlmClientConfig(options: LlmClientOptions): ResolvedLlmClientConfig {
  const provider = options.provider ?? config.llm.provider;

  if (provider === "local") {
    return {
      provider,
      endpoint: options.endpoint ?? (config.localLlm.endpoint || DEFAULT_LOCAL_LLM_ENDPOINT),
      model: options.model ?? (config.localLlm.model || DEFAULT_LOCAL_LLM_MODEL),
      apiKey: options.apiKey ?? config.localLlm.apiKey,
      organization: "",
      fetchImpl: options.fetchImpl ?? fetch,
    };
  }

  return {
    provider,
    endpoint: options.endpoint ?? (config.llm.endpoint || DEFAULT_OPENAI_ENDPOINT),
    model: options.model ?? (config.openai.defaultModel || "gpt-5.1"),
    apiKey: options.apiKey ?? config.openai.apiKey,
    organization: options.organization ?? config.openai.organization,
    fetchImpl: options.fetchImpl ?? fetch,
  };
}

function extractAssistantContent(payload: Record<string, unknown>): string | null {
  const choices = payload.choices;
  if (!Array.isArray(choices)) {
    return null;
  }

  const firstChoice = choices[0];
  if (!firstChoice || typeof firstChoice !== "object") {
    return null;
  }

  const message = (firstChoice as { message?: unknown }).message;
  if (!message || typeof message !== "object") {
    return null;
  }

  const content = (message as { content?: unknown }).content;
  return typeof content === "string" ? content : null;
}
