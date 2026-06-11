import * as Sentry from "@sentry/nextjs";
import { initSentryIfConfigured } from "./sentry.shared.js";

initSentryIfConfigured(Sentry);
