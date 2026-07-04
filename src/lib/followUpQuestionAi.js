import {
  callAnthropic,
  DEFAULT_ANTHROPIC_MODEL,
  getAnthropicClientConfig,
  isAnthropicAiEnabled,
} from "@/lib/anthropicClient";
import {
  buildFollowUpQuestionSystemPrompt,
  buildFollowUpQuestionUserMessage,
} from "@/lib/followUpQuestionPrompts";
import { validateFollowUpQuestionContent } from "@/lib/followUpQuestionSafety";
import {
  FOLLOW_UP_SOURCES,
  followUpAiResponseSchema,
  parseFollowUpAiResponseText,
  validateFollowUpAiResponse,
} from "@/lib/followUpQuestionSchemas";

const SONNET_MODEL = "claude-sonnet-5";

/**
 * @param {Record<string, unknown>} input
 */
export function isMerchantPolicyAiAllowed(input = {}) {
  if (input.merchantPolicyAllowsAi === true) {
    return true;
  }

  const policyResult = /** @type {Record<string, unknown> | null} */ (
    input.policyResult ?? null
  );

  if (policyResult?.allowAiFollowUp === true) {
    return true;
  }

  const merchantSettings = /** @type {Record<string, unknown> | null} */ (
    input.merchantSettings ?? null
  );

  return merchantSettings?.allowAiFollowUp === true;
}

/**
 * @param {Record<string, unknown>} input
 */
export function isItemHardBlocked(input = {}) {
  if (input.itemHardBlocked === true) {
    return true;
  }

  const itemInformation = /** @type {Record<string, unknown> | null} */ (
    input.itemInformation ?? null
  );

  return (
    itemInformation?.hardBlocked === true ||
    itemInformation?.blockedReason === "hard_blocked"
  );
}

/**
 * @param {Record<string, unknown>} input
 */
export function canUseAiForFollowUp(input = {}) {
  if (!isAnthropicAiEnabled()) {
    return false;
  }

  if (!getAnthropicClientConfig().apiKey) {
    return false;
  }

  if (!isMerchantPolicyAiAllowed(input)) {
    return false;
  }

  if (isItemHardBlocked(input)) {
    return false;
  }

  return true;
}

/**
 * @param {Record<string, unknown>} input
 */
function resolveAiModel(input = {}) {
  if (input.aiModel === SONNET_MODEL || input.useSonnet === true) {
    return SONNET_MODEL;
  }

  return DEFAULT_ANTHROPIC_MODEL;
}

/**
 * @param {{
 *   question: string;
 *   questionType: string;
 *   reasonCode: string;
 *   confidence?: number | null;
 * }} params
 */
function buildAiFollowUpResult({
  question,
  questionType,
  reasonCode,
  confidence = null,
}) {
  const safety = validateFollowUpQuestionContent(question);

  if (!safety.safe) {
    return null;
  }

  return {
    shouldAskFollowUp: true,
    question,
    questionType,
    reasonCode,
    confidence: typeof confidence === "number" ? confidence : 0.75,
    source: FOLLOW_UP_SOURCES.AI,
    fallbackUsed: false,
    blockedReason: null,
  };
}

/**
 * @param {unknown} parsedOutput
 * @param {string} reasonCode
 */
function finalizeValidatedAiResponse(parsedOutput, reasonCode) {
  const validation = validateFollowUpAiResponse(parsedOutput);

  if (!validation.valid || !validation.data) {
    return null;
  }

  return buildAiFollowUpResult({
    question: validation.data.question,
    questionType: validation.data.questionType,
    reasonCode,
    confidence: validation.data.confidence,
  });
}

/**
 * @param {{
 *   input: Record<string, unknown>;
 *   reasonCode: string;
 *   followUpType: string | null;
 * }} params
 */
export async function generateAiFollowUpQuestion({
  input,
  reasonCode,
  followUpType,
}) {
  const model = resolveAiModel(input);
  const system = buildFollowUpQuestionSystemPrompt();
  const userMessage = buildFollowUpQuestionUserMessage({
    reasonCode,
    followUpType,
    merchantRecoveryRule: input.merchantRecoveryRule,
    policyResult: input.policyResult,
    existingFollowUpAnswers: input.existingFollowUpAnswers,
    itemInformation: input.itemInformation,
  });

  const structuredResult = await callAnthropic({
    model,
    system,
    messages: [{ role: "user", content: userMessage }],
    schema: followUpAiResponseSchema,
    maxTokens: 256,
    metadata: { feature: "follow_up_question" },
    allowFallback: false,
  });

  if (structuredResult.success && structuredResult.parsedOutput) {
    return finalizeValidatedAiResponse(
      structuredResult.parsedOutput,
      reasonCode,
    );
  }

  if (structuredResult.errorType === "structured_output_unavailable") {
    const promptParseResult = await callAnthropic({
      model,
      system: `${system} Respond with JSON only using keys question and questionType.`,
      messages: [
        {
          role: "user",
          content: `${userMessage}\n\nReturn JSON only: {"question":"...","questionType":"..."}`,
        },
      ],
      maxTokens: 256,
      metadata: { feature: "follow_up_question_prompt_parse" },
      allowFallback: false,
    });

    if (promptParseResult.success && promptParseResult.content) {
      const parsed = parseFollowUpAiResponseText(promptParseResult.content);

      if (parsed.valid && parsed.data) {
        return buildAiFollowUpResult({
          question: parsed.data.question,
          questionType: parsed.data.questionType,
          reasonCode,
          confidence: parsed.data.confidence,
        });
      }
    }
  }

  return null;
}
