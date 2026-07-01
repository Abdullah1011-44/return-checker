-- Task 32: add PRODUCT_EXCLUSION recovery rule type for merchant product exclusion matchers.
ALTER TYPE "RecoveryRuleType" ADD VALUE IF NOT EXISTS 'PRODUCT_EXCLUSION';
