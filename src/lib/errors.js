import { Prisma } from "@prisma/client";
import { NextResponse } from "next/server";
import { z } from "zod";

/**
 * Safe API error handling helpers for Next.js App Router route handlers.
 *
 * Use these utilities in API routes to return consistent JSON error responses
 * without exposing stack traces, raw error objects, process.env values,
 * access tokens, API keys, or database connection strings.
 */

export class AppError extends Error {
  constructor(message, status = 400, code = "APP_ERROR") {
    super(message);
    this.name = "AppError";
    this.status = status;
    this.code = code;
    this.isOperational = true;
  }
}

function isPrismaKnownRequestError(error) {
  return error instanceof Prisma.PrismaClientKnownRequestError;
}

function sanitizeLogMessage(message) {
  if (typeof message !== "string" || !message) {
    return "Unknown error";
  }

  return message
    .replace(/Bearer\s+\S+/gi, "Bearer [REDACTED]")
    .replace(/shpat_[a-zA-Z0-9]+/gi, "[REDACTED_TOKEN]")
    .replace(/postgresql:\/\/\S+/gi, "[REDACTED_DATABASE_URL]")
    .replace(/sk_[a-zA-Z0-9_]+/gi, "[REDACTED_API_KEY]");
}

/**
 * Build a safe JSON error response for API clients.
 * Never includes stack traces, raw errors, or secret values.
 */
export function createApiErrorResponse(
  message,
  status = 500,
  code = "INTERNAL_ERROR",
  extra = {}
) {
  return NextResponse.json(
    {
      success: false,
      error: message,
      code,
      ...extra,
    },
    { status }
  );
}

/**
 * Map an unknown error to a safe user-facing message.
 */
export function safeErrorMessage(
  error,
  fallback = "Something went wrong. Please try again."
) {
  if (error instanceof AppError) {
    return error.message;
  }

  if (error instanceof z.ZodError) {
    return "Invalid request";
  }

  if (isPrismaKnownRequestError(error)) {
    if (error.code === "P2002") {
      return "Duplicate record";
    }
    if (error.code === "P2025") {
      return "Record not found";
    }
    return fallback;
  }

  return fallback;
}

/**
 * Log server-side debugging info without sensitive data.
 */
export function logSafeError(context, error) {
  const payload = {
    context,
    name: error instanceof Error ? error.name : "UnknownError",
    message: sanitizeLogMessage(safeErrorMessage(error)),
  };

  if (error instanceof AppError) {
    payload.code = error.code;
    payload.status = error.status;
  }

  console.error("[API Error]", payload);
}

/**
 * Central catch-block helper for API routes.
 * Logs safely on the server and returns a client-safe response.
 */
export function handleApiError(error, options = {}) {
  const {
    fallbackMessage = "Something went wrong. Please try again.",
    fallbackCode = "INTERNAL_ERROR",
    context = "api",
  } = options;

  logSafeError(context, error);

  if (error instanceof AppError) {
    return createApiErrorResponse(error.message, error.status, error.code);
  }

  if (error instanceof z.ZodError) {
    return createApiErrorResponse("Invalid request", 400, "VALIDATION_ERROR");
  }

  if (isPrismaKnownRequestError(error)) {
    if (error.code === "P2002") {
      return createApiErrorResponse("Duplicate record", 409, "DUPLICATE_RECORD");
    }
    if (error.code === "P2025") {
      return createApiErrorResponse("Record not found", 404, "NOT_FOUND");
    }
  }

  return createApiErrorResponse(fallbackMessage, 500, fallbackCode);
}
