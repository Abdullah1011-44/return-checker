/** Client-safe constants for merchant dashboard UI (no server imports). */

export const STORE_TYPES = [
  "GENERAL",
  "FASHION",
  "ELECTRONICS",
  "BEAUTY",
  "HOME",
  "FOOD",
  "OTHER",
];

export const RECOVERY_RULE_TYPES = [
  "EXCHANGE",
  "STORE_CREDIT",
  "PARTIAL_REFUND",
  "MANUAL_REVIEW",
];

export const RECOVERY_RULE_PRIORITY_MIN = 1;
export const RECOVERY_RULE_PRIORITY_MAX = 4;

export const RECOVERY_RULE_PRIORITY_OPTIONS = [
  { value: 1, label: "1 — First" },
  { value: 2, label: "2 — Second" },
  { value: 3, label: "3 — Third" },
  { value: 4, label: "4 — Fourth" },
];
