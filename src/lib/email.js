import { optionalEnv } from "@/lib/env";
import { Resend } from "resend";

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function hasHeaderInjection(value) {
  return /[\r\n]/.test(value);
}

function isValidEmail(value) {
  if (typeof value !== "string") {
    return false;
  }

  const trimmed = value.trim();
  if (!trimmed || trimmed.length > 254) {
    return false;
  }

  return EMAIL_PATTERN.test(trimmed);
}

/**
 * Send a transactional email via Resend.
 * Never logs RESEND_API_KEY or stack traces.
 */
export async function sendEmail({ to, subject, html, text }) {
  const resendApiKey = optionalEnv("RESEND_API_KEY", "");
  const emailFrom = optionalEnv("EMAIL_FROM", "");

  console.log("[Email] sendEmail called", {
    hasApiKey: Boolean(resendApiKey),
    hasFrom: Boolean(emailFrom),
    toProvided: Boolean(to),
    subjectProvided: Boolean(subject),
  });

  if (!resendApiKey || !emailFrom) {
    console.error("[Email] Missing config", {
      hasApiKey: Boolean(resendApiKey),
      hasFrom: Boolean(emailFrom),
    });
    return { success: false, error: "EMAIL_CONFIG_MISSING" };
  }

  if (!to || !isValidEmail(to)) {
    console.error("[Email] Invalid recipient email", {
      toProvided: Boolean(to),
    });
    return { success: false, error: "INVALID_EMAIL_TO" };
  }

  if (!subject || typeof subject !== "string" || !subject.trim()) {
    console.error("[Email] Invalid email header");
    return { success: false, error: "INVALID_EMAIL_HEADER" };
  }

  if (hasHeaderInjection(to) || hasHeaderInjection(subject)) {
    console.error("[Email] Invalid email header");
    return { success: false, error: "INVALID_EMAIL_HEADER" };
  }

  if (!html && !text) {
    console.error("[Email] Invalid email header");
    return { success: false, error: "INVALID_EMAIL_HEADER" };
  }

  try {
    const resend = new Resend(resendApiKey);
    const result = await resend.emails.send({
      from: emailFrom,
      to: to.trim(),
      subject: subject.trim(),
      html: html ?? undefined,
      text: text ?? undefined,
    });

    if (result.error) {
      console.error("[Email] Resend send failed", {
        name: result.error.name,
        message: result.error.message,
      });
      return { success: false, error: "EMAIL_SEND_FAILED" };
    }

    if (!result.data?.id) {
      console.error("[Email] Resend send failed", {
        name: "MissingMessageId",
        message: "Resend returned no message id",
      });
      return { success: false, error: "EMAIL_SEND_FAILED" };
    }

    console.log("[Email] Sent successfully", {
      id: result.data.id,
    });

    return { success: true, id: result.data.id };
  } catch (error) {
    console.error("[Email] Unexpected failure", {
      message: error instanceof Error ? error.message : "Unknown error",
    });
    return { success: false, error: "EMAIL_SEND_FAILED" };
  }
}
