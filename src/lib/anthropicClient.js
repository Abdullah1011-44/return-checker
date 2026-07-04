import Anthropic, {
  APIConnectionTimeoutError,
  APIError,
  APIUserAbortError,
} from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { optionalEnv } from "@/lib/env";

export const DEFAULT_ANTHROPIC_MODEL = "claude-haiku-4-5-20251001";
export const DEFAULT_ANTHROPIC_FALLBACK_MODEL = "claude-sonnet-5";
export const DEFAULT_ANTHROPIC_TIMEOUT_MS = 15_000;

const IS_DEV = process.env.NODE_ENV === "development";
const SENSITIVE_LOG_PATTERN =
  /(shpat_[a-z0-9]+|sk-ant-[a-z0-9-]+|[\w.+-]+@[\w.-]+\.\w+|access[_-]?token|api[_-]?key)/i;

/** @type {Anthropic | null} */
let anthropicClient = null;

/**
 * @param {unknown} value
 */
function parseBooleanEnv(value) {
  if (typeof value !== "string") {
    return false;
  }

  const normalized = value.trim().toLowerCase();
  return normalized === "true" || normalized === "1" || normalized === "yes";
}

/**
 * @param {unknown} value
 * @param {number} fallback
 */
function parsePositiveInt(value, fallback) {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export function isAnthropicAiEnabled() {
  return parseBooleanEnv(optionalEnv("FOLLOW_UP_AI_ENABLED", "false"));
}

export function getAnthropicClientConfig() {
  return {
    apiKey: optionalEnv("ANTHROPIC_API_KEY"),
    model: optionalEnv("ANTHROPIC_MODEL", DEFAULT_ANTHROPIC_MODEL),
    fallbackModel: optionalEnv(
      "ANTHROPIC_FALLBACK_MODEL",
      DEFAULT_ANTHROPIC_FALLBACK_MODEL,
    ),
    timeoutMs: parsePositiveInt(
      optionalEnv("FOLLOW_UP_AI_TIMEOUT_MS"),
      DEFAULT_ANTHROPIC_TIMEOUT_MS,
    ),
    enabled: isAnthropicAiEnabled(),
  };
}

/**
 * @param {{ model?: string | null, fallbackModel?: string | null }} [params]
 */
export function resolveAnthropicModels(params = {}) {
  const config = getAnthropicClientConfig();

  return {
    primary: params.model || config.model,
    fallback: params.fallbackModel || config.fallbackModel,
  };
}

/**
 * @param {string | null | undefined} model
 */
export function shouldUseSonnetLowEffort(model) {
  if (!model || typeof model !== "string") {
    return false;
  }

  return model === "claude-sonnet-5" || model.startsWith("claude-sonnet-5-");
}

/**
 * @param {unknown} value
 */
function sanitizeLogValue(value) {
  if (value == null) {
    return value;
  }

  const text = String(value);
  if (SENSITIVE_LOG_PATTERN.test(text)) {
    return "[REDACTED]";
  }

  return text;
}

/**
 * @param {Record<string, unknown> | null | undefined} metadata
 */
export function sanitizeAnthropicMetadata(metadata) {
  if (!metadata || typeof metadata !== "object") {
    return undefined;
  }

  const safe = {};
  for (const [key, value] of Object.entries(metadata)) {
    if (SENSITIVE_LOG_PATTERN.test(key)) {
      continue;
    }

    if (
      typeof value === "string" ||
      typeof value === "number" ||
      typeof value === "boolean"
    ) {
      safe[key] = sanitizeLogValue(value);
    }
  }

  return Object.keys(safe).length > 0 ? safe : undefined;
}

/**
 * @param {string} phase
 * @param {Record<string, unknown>} payload
 */
function debugAnthropicClient(phase, payload) {
  if (!IS_DEV) {
    return;
  }

  console.debug(`[anthropic-client:${phase}]`, payload);
}

/**
 * @param {Array<{ role?: string, content?: unknown }> | null | undefined} messages
 */
function extractMessageText(message) {
  const blocks = Array.isArray(message?.content) ? message.content : [];

  return blocks
    .map((block) => {
      if (block && typeof block === "object" && block.type === "text") {
        return typeof block.text === "string" ? block.text : "";
      }

      return "";
    })
    .join("")
    .trim();
}

/**
 * @param {{
 *   model: string;
 *   system?: string | null;
 *   messages: Array<{ role: string, content: string }>;
 *   schema?: import("zod").ZodType | null;
 *   maxTokens?: number | null;
 *   metadata?: Record<string, unknown> | null;
 * }} params
 */
export function buildAnthropicRequestParams({
  model,
  system,
  messages,
  schema,
  maxTokens,
  metadata,
}) {
  /** @type {Record<string, unknown>} */
  const params = {
    model,
    max_tokens: maxTokens ?? 1024,
    messages,
  };

  if (system) {
    params.system = system;
  }

  const safeMetadata = sanitizeAnthropicMetadata(metadata);
  if (safeMetadata) {
    params.metadata = safeMetadata;
  }

  if (shouldUseSonnetLowEffort(model)) {
    params.effort = "low";
  }

  if (schema) {
    params.output_config = {
      format: zodOutputFormat(schema),
    };
  }

  return params;
}

/**
 * @param {unknown} error
 */
export function normalizeAnthropicError(error) {
  if (
    error instanceof APIUserAbortError ||
    error instanceof APIConnectionTimeoutError ||
    (error instanceof Error &&
      (error.name === "AbortError" || error.name === "APIUserAbortError"))
  ) {
    return { success: false, errorType: "timeout" };
  }

  if (error instanceof APIError) {
    return {
      success: false,
      errorType: "api_error",
      status: error.status ?? null,
    };
  }

  if (error instanceof Error) {
    if (/structured output|output_config|json_schema/i.test(error.message)) {
      return {
        success: false,
        errorType: "structured_output_unavailable",
      };
    }

    if (/parse structured output|parsed_output/i.test(error.message)) {
      return {
        success: false,
        errorType: "invalid_response",
      };
    }
  }

  return {
    success: false,
    errorType: "api_error",
  };
}

/**
 * @param {string} apiKey
 */
function getAnthropicClient(apiKey) {
  if (!anthropicClient) {
    anthropicClient = new Anthropic({ apiKey });
  }

  return anthropicClient;
}

export function resetAnthropicClientForTests() {
  anthropicClient = null;
}

/**
 * @param {() => Promise<unknown>} operation
 * @param {number} timeoutMs
 */
async function withAnthropicTimeout(operation, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    return await operation(controller.signal);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * @param {{
 *   model: string;
 *   requestParams: Record<string, unknown>;
 *   schema?: import("zod").ZodType | null;
 *   timeoutMs: number;
 *   client: Anthropic;
 * }} params
 */
async function executeAnthropicRequest({
  model,
  requestParams,
  schema,
  timeoutMs,
  client,
}) {
  debugAnthropicClient("request:start", {
    model,
    apiType: schema ? "structured" : "text",
    messageCount: Array.isArray(requestParams.messages)
      ? requestParams.messages.length
      : 0,
    maxTokens: requestParams.max_tokens,
    timeoutMs,
    hasSchema: Boolean(schema),
    metadata: sanitizeAnthropicMetadata(
      /** @type {Record<string, unknown> | undefined} */ (
        requestParams.metadata
      ),
    ),
  });

  try {
    if (schema) {
      const message = await withAnthropicTimeout(
        (signal) =>
          client.messages.parse(
            /** @type {import("@anthropic-ai/sdk").MessageCreateParamsNonStreaming} */ (
              requestParams
            ),
            { signal },
          ),
        timeoutMs,
      );

      if (message.parsed_output == null) {
        debugAnthropicClient("request:invalid-response", {
          model,
          reason: "missing_parsed_output",
        });

        return {
          success: false,
          errorType: "invalid_response",
        };
      }

      debugAnthropicClient("request:success", {
        model,
        apiType: "structured",
        stopReason: message.stop_reason ?? null,
      });

      return {
        success: true,
        model,
        structuredOutputUsed: true,
        parsedOutput: message.parsed_output,
        usage: message.usage ?? null,
      };
    }

    const message = await withAnthropicTimeout(
      (signal) =>
        client.messages.create(
          /** @type {import("@anthropic-ai/sdk").MessageCreateParamsNonStreaming} */ (
            requestParams
          ),
          { signal },
        ),
      timeoutMs,
    );

    const content = extractMessageText(message);

    debugAnthropicClient("request:success", {
      model,
      apiType: "text",
      stopReason: message.stop_reason ?? null,
      contentLength: content.length,
    });

    return {
      success: true,
      model,
      structuredOutputUsed: false,
      content,
      usage: message.usage ?? null,
    };
  } catch (error) {
    const normalized = normalizeAnthropicError(error);

    debugAnthropicClient("request:failure", {
      model,
      errorType: normalized.errorType,
      status: normalized.status ?? null,
    });

    return normalized;
  }
}

/**
 * Generic Anthropic Messages API wrapper for all AI features.
 *
 * @param {{
 *   model?: string | null;
 *   system?: string | null;
 *   messages: Array<{ role: string, content: string }>;
 *   schema?: import("zod").ZodType | null;
 *   maxTokens?: number | null;
 *   timeout?: number | null;
 *   metadata?: Record<string, unknown> | null;
 *   allowFallback?: boolean;
 * }} params
 */
export async function callAnthropic({
  model,
  system,
  messages,
  schema = null,
  maxTokens,
  timeout,
  metadata,
  allowFallback = true,
} = {}) {
  if (!isAnthropicAiEnabled()) {
    return { success: false, disabled: true };
  }

  const config = getAnthropicClientConfig();

  if (!config.apiKey) {
    return {
      success: false,
      errorType: "api_error",
    };
  }

  if (!Array.isArray(messages) || messages.length === 0) {
    return {
      success: false,
      errorType: "invalid_response",
    };
  }

  const { primary, fallback } = resolveAnthropicModels({ model });
  const timeoutMs = timeout ?? config.timeoutMs;
  const client = getAnthropicClient(config.apiKey);

  const runForModel = (selectedModel) =>
    executeAnthropicRequest({
      model: selectedModel,
      requestParams: buildAnthropicRequestParams({
        model: selectedModel,
        system,
        messages,
        schema,
        maxTokens,
        metadata,
      }),
      schema,
      timeoutMs,
      client,
    });

  const primaryResult = await runForModel(primary);

  if (primaryResult.success || primaryResult.disabled) {
    return primaryResult;
  }

  if (
    primaryResult.errorType === "timeout" ||
    primaryResult.errorType === "invalid_response" ||
    primaryResult.errorType === "structured_output_unavailable"
  ) {
    return primaryResult;
  }

  if (
    !allowFallback ||
    !fallback ||
    fallback === primary ||
    primaryResult.errorType !== "api_error"
  ) {
    return primaryResult;
  }

  const fallbackResult = await runForModel(fallback);

  if (fallbackResult.success) {
    return {
      ...fallbackResult,
      fallbackUsed: true,
      primaryModel: primary,
    };
  }

  return fallbackResult;
}
