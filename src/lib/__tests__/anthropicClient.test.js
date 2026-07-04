import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";

const mockParse = vi.fn();
const mockCreate = vi.fn();

class MockAPIError extends Error {
  constructor(status, message = "API error") {
    super(message);
    this.name = "APIError";
    this.status = status;
  }
}

class MockAPIConnectionTimeoutError extends Error {
  constructor({ message } = {}) {
    super(message ?? "Timed out");
    this.name = "APIConnectionTimeoutError";
  }
}

class MockAPIUserAbortError extends Error {
  constructor({ message } = {}) {
    super(message ?? "Aborted");
    this.name = "APIUserAbortError";
  }
}

vi.mock("@anthropic-ai/sdk", () => ({
  default: class Anthropic {
    messages = {
      parse: (...args) => mockParse(...args),
      create: (...args) => mockCreate(...args),
    };
  },
  APIError: MockAPIError,
  APIConnectionTimeoutError: MockAPIConnectionTimeoutError,
  APIUserAbortError: MockAPIUserAbortError,
}));

describe("anthropicClient", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    delete process.env.FOLLOW_UP_AI_ENABLED;
    delete process.env.ANTHROPIC_API_KEY;
    delete process.env.ANTHROPIC_MODEL;
    delete process.env.ANTHROPIC_FALLBACK_MODEL;
    delete process.env.FOLLOW_UP_AI_TIMEOUT_MS;
  });

  afterEach(async () => {
    const { resetAnthropicClientForTests } = await import(
      "@/lib/anthropicClient"
    );
    resetAnthropicClientForTests();
  });

  async function loadClient() {
    return import("@/lib/anthropicClient");
  }

  it("returns disabled when FOLLOW_UP_AI_ENABLED is false", async () => {
    process.env.FOLLOW_UP_AI_ENABLED = "false";
    process.env.ANTHROPIC_API_KEY = "sk-ant-test";

    const { callAnthropic } = await loadClient();
    const result = await callAnthropic({
      messages: [{ role: "user", content: "Hello" }],
    });

    expect(result).toEqual({ success: false, disabled: true });
    expect(mockParse).not.toHaveBeenCalled();
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it("returns timeout failure without throwing", async () => {
    process.env.FOLLOW_UP_AI_ENABLED = "true";
    process.env.ANTHROPIC_API_KEY = "sk-ant-test";
    process.env.FOLLOW_UP_AI_TIMEOUT_MS = "50";

    mockCreate.mockImplementation(
      () =>
        new Promise((_resolve, reject) => {
          setTimeout(() => {
            reject(new MockAPIUserAbortError({ message: "Request aborted" }));
          }, 100);
        }),
    );

    const { callAnthropic } = await loadClient();
    const result = await callAnthropic({
      messages: [{ role: "user", content: "Hello" }],
    });

    expect(result).toEqual({ success: false, errorType: "timeout" });
  });

  it("returns api_error on API failure", async () => {
    process.env.FOLLOW_UP_AI_ENABLED = "true";
    process.env.ANTHROPIC_API_KEY = "sk-ant-test";

    mockCreate.mockRejectedValue(new MockAPIError(500, "Server error"));

    const { callAnthropic } = await loadClient();
    const result = await callAnthropic({
      messages: [{ role: "user", content: "Hello" }],
      allowFallback: false,
    });

    expect(result).toEqual({
      success: false,
      errorType: "api_error",
      status: 500,
    });
  });

  it("returns successful text response", async () => {
    process.env.FOLLOW_UP_AI_ENABLED = "true";
    process.env.ANTHROPIC_API_KEY = "sk-ant-test";
    process.env.ANTHROPIC_MODEL = "claude-haiku-4-5-20251001";

    mockCreate.mockResolvedValue({
      stop_reason: "end_turn",
      content: [{ type: "text", text: "Hello there" }],
      usage: { input_tokens: 10, output_tokens: 5 },
    });

    const { callAnthropic } = await loadClient();
    const result = await callAnthropic({
      messages: [{ role: "user", content: "Hello" }],
      allowFallback: false,
    });

    expect(result).toEqual({
      success: true,
      model: "claude-haiku-4-5-20251001",
      structuredOutputUsed: false,
      content: "Hello there",
      usage: { input_tokens: 10, output_tokens: 5 },
    });
  });

  it("uses fallback model after primary api_error", async () => {
    process.env.FOLLOW_UP_AI_ENABLED = "true";
    process.env.ANTHROPIC_API_KEY = "sk-ant-test";
    process.env.ANTHROPIC_MODEL = "claude-haiku-4-5-20251001";
    process.env.ANTHROPIC_FALLBACK_MODEL = "claude-sonnet-5";

    mockCreate
      .mockRejectedValueOnce(new MockAPIError(500, "Primary failed"))
      .mockResolvedValueOnce({
        stop_reason: "end_turn",
        content: [{ type: "text", text: "Fallback answer" }],
        usage: { input_tokens: 12, output_tokens: 6 },
      });

    const { callAnthropic } = await loadClient();
    const result = await callAnthropic({
      messages: [{ role: "user", content: "Hello" }],
    });

    expect(mockCreate).toHaveBeenCalledTimes(2);
    expect(mockCreate.mock.calls[0][0].model).toBe("claude-haiku-4-5-20251001");
    expect(mockCreate.mock.calls[1][0].model).toBe("claude-sonnet-5");
    expect(mockCreate.mock.calls[1][0].effort).toBe("low");
    expect(result).toMatchObject({
      success: true,
      model: "claude-sonnet-5",
      fallbackUsed: true,
      primaryModel: "claude-haiku-4-5-20251001",
      content: "Fallback answer",
    });
  });

  it("uses structured outputs with zod schema via messages.parse", async () => {
    process.env.FOLLOW_UP_AI_ENABLED = "true";
    process.env.ANTHROPIC_API_KEY = "sk-ant-test";

    const schema = z.object({ answer: z.string() });

    mockParse.mockResolvedValue({
      stop_reason: "end_turn",
      parsed_output: { answer: "blue" },
      usage: { input_tokens: 8, output_tokens: 4 },
    });

    const { callAnthropic } = await loadClient();
    const result = await callAnthropic({
      messages: [{ role: "user", content: "Favorite color?" }],
      schema,
      allowFallback: false,
    });

    expect(mockParse).toHaveBeenCalledOnce();
    expect(mockCreate).not.toHaveBeenCalled();
    expect(mockParse.mock.calls[0][0].output_config?.format).toBeDefined();
    expect(result).toEqual({
      success: true,
      model: "claude-haiku-4-5-20251001",
      structuredOutputUsed: true,
      parsedOutput: { answer: "blue" },
      usage: { input_tokens: 8, output_tokens: 4 },
    });
  });

  it("sets effort low for claude-sonnet-5 without temperature params", async () => {
    const { buildAnthropicRequestParams } = await loadClient();

    const params = buildAnthropicRequestParams({
      model: "claude-sonnet-5",
      messages: [{ role: "user", content: "Hello" }],
    });

    expect(params.effort).toBe("low");
    expect(params).not.toHaveProperty("temperature");
    expect(params).not.toHaveProperty("top_p");
    expect(params).not.toHaveProperty("top_k");
  });

  it("resolves default models from environment", async () => {
    process.env.ANTHROPIC_MODEL = "claude-haiku-4-5-20251001";
    process.env.ANTHROPIC_FALLBACK_MODEL = "claude-sonnet-5";

    const { resolveAnthropicModels } = await loadClient();

    expect(resolveAnthropicModels({})).toEqual({
      primary: "claude-haiku-4-5-20251001",
      fallback: "claude-sonnet-5",
    });
  });
});
