import { describe, expect, it } from "vitest";
import { createLlmClient, type LlmMessage } from "@/lib/llm/client";

describe("llm client", () => {
  it("posts OpenAI-compatible chat completions to the local provider", async () => {
    const requests: Array<{ url: RequestInfo | URL; init?: RequestInit }> = [];
    const client = createLlmClient({
      provider: "local",
      fetchImpl: async (url, init) => {
        requests.push({ url, init });
        return new Response(
          JSON.stringify({
            choices: [{ message: { content: " pong " } }],
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      },
    });

    const result = await client.complete("Reply with pong.");

    expect(result).toBe("pong");
    expect(requests[0]?.url).toBe("http://127.0.0.1:11434/v1/chat/completions");
    const body = JSON.parse(String(requests[0]?.init?.body)) as {
      model: string;
      messages: LlmMessage[];
      stream: boolean;
    };
    expect(body.model).toBe("qwen3-14b-awq");
    expect(body.messages).toEqual([{ role: "user", content: "Reply with pong." }]);
    expect(body.stream).toBe(false);
  });

  it("adds OpenAI auth and organization headers for the OpenAI provider", async () => {
    const requests: RequestInit[] = [];
    const client = createLlmClient({
      provider: "openai",
      apiKey: "sk_test_header",
      organization: "org_test",
      fetchImpl: async (_url, init) => {
        requests.push(init ?? {});
        return new Response(
          JSON.stringify({
            choices: [{ message: { content: "done" } }],
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      },
    });

    await client.completeChat([{ role: "user", content: "hello" }]);

    expect(requests[0]?.headers).toMatchObject({
      Authorization: "Bearer sk_test_header",
      "OpenAI-Organization": "org_test",
    });
  });
});
