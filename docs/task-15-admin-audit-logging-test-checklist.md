# Task 15 — Admin Audit Logging Manual Test Checklist

Manual tests for `AdminAuditLog` persistence (merchant/system/admin events) and safe unauthorized access logging.

**Prerequisites**

- Dev server running: `npm run dev` (default `http://localhost:3000`)
- Database migrated and Prisma client generated
- Merchant dashboard session for authenticated sync tests
- Migration: `20260602140000_add_admin_audit_log`

```powershell
$base = "http://localhost:3000"
```

**Helpers**

- `src/lib/adminAudit.js` — `safeCreateAdminAuditLog`, `logUnauthorizedApiAccess`, `getAuditRequestContext`
- `src/lib/audit.js` — `ReturnEvent` helpers (return-request scope only)
- **AdminAuditLog** → Shopify sync, webhooks, unauthorized API access
- **ReturnEvent** → customer submission, merchant actions, email (unchanged from Task 14)

---

## 1. Prisma model test

### Steps

1. Apply migrations (if not already applied):

```powershell
npx prisma migrate deploy
```

2. Regenerate client:

```powershell
npx prisma generate
```

3. Open Prisma Studio:

```powershell
npx prisma studio
```

4. Confirm **AdminAuditLog** table exists with columns:
   - `id`, `merchantId`, `actorType`, `actorUserId`, `eventType`, `severity`
   - `resourceType`, `resourceId`, `message`, `metadata`
   - `ipAddress`, `userAgent`, `createdAt`

5. Confirm **Merchant** has relation `adminAuditLogs` (visible when browsing Merchant rows).

6. Confirm **ReturnEvent** still exists (not replaced).

### Expected

- `AdminAuditLog` table is present and queryable.
- No data loss in existing tables.

**Note:** If `npx prisma migrate dev` reports drift and asks to reset, do **not** reset production/dev data. Use `npx prisma migrate deploy` instead (see Task 15A).

---

## 2. Shopify sync audit test

**Route:** `POST /api/shopify/orders/sync`  
**Table:** `AdminAuditLog`

### Steps

1. Log in to merchant dashboard with Shopify-connected merchant.
2. Open Prisma Studio → **AdminAuditLog** (keep open or refresh after sync).
3. Click **Sync Shopify Orders** once.
4. Find the newest rows for your merchant (or filter `eventType`).

### Expected

| Scenario | `eventType` | `severity` | `resourceType` |
|----------|-------------|------------|----------------|
| Sync begins | `SHOPIFY_SYNC_STARTED` | `INFO` | `SHOPIFY_SYNC` |
| Sync succeeds | `SHOPIFY_SYNC_COMPLETED` | `INFO` | `SHOPIFY_SYNC` |
| Protected data blocked | `SHOPIFY_PROTECTED_CUSTOMER_DATA_REQUIRED` | `WARN` | `SHOPIFY_SYNC` |
| Other failure | `SHOPIFY_SYNC_FAILED` | `ERROR` | `SHOPIFY_SYNC` |
| App rate limit (6+ in 5 min) | `RATE_LIMIT_TRIGGERED` | `WARN` | `SHOPIFY_SYNC` |

**Metadata checks (protected data or started):**

```json
{
  "shopDomain": "your-store.myshopify.com",
  "hasToken": true
}
```

**Pass if:**

- `SHOPIFY_SYNC_STARTED` row exists after each sync attempt (when authenticated).
- If protected customer data is not approved, `SHOPIFY_PROTECTED_CUSTOMER_DATA_REQUIRED` exists with `httpStatus: 403`.
- `metadata.hasToken` is `true` or `false` only — **no** `shopifyAccessToken` or `shpat_` value.
- `ipAddress` / `userAgent` may be present; no cookies or authorization header.
- Dashboard still shows protected-data or rate-limit messages (responses unchanged).

---

## 3. Webhook audit test

**Routes:** `/api/webhooks/*`  
**Table:** `AdminAuditLog`

### Steps — invalid HMAC

```powershell
$r = Invoke-WebRequest -Method POST -Uri "$base/api/webhooks/app-uninstalled" `
  -ContentType "application/json" `
  -Body '{"shop_domain":"test.myshopify.com"}' `
  -Headers @{ "X-Shopify-Hmac-Sha256" = "invalid" } `
  -SkipHttpErrorCheck
$r.StatusCode
```

Refresh **AdminAuditLog** in Prisma Studio.

### Steps — valid webhook (if available)

Use Shopify CLI or Partner Dashboard test delivery for `app/uninstalled`, `customers/data_request`, etc.

### Expected

| Scenario | `eventType` | `severity` |
|----------|-------------|------------|
| Request received | `WEBHOOK_RECEIVED` | `INFO` |
| Bad HMAC | `WEBHOOK_INVALID_HMAC` | `SECURITY` |
| Data request (valid) | `CUSTOMERS_DATA_REQUEST` | `INFO` |
| Customer redact (valid) | `CUSTOMERS_REDACT` | `WARN` |
| Shop redact (valid) | `SHOP_REDACT` | `WARN` |

**Pass if:**

- `WEBHOOK_RECEIVED` and/or `WEBHOOK_INVALID_HMAC` rows exist.
- Invalid HMAC returns HTTP **401** with `code: "INVALID_WEBHOOK_HMAC"`.
- `WEBHOOK_INVALID_HMAC` has `severity = SECURITY`.
- `metadata` includes safe fields: `routeName`, `shopDomain`, `topic`, `reason` — not raw JSON body or HMAC digest.
- `resourceType` is `SHOPIFY_WEBHOOK` (or `SHOPIFY_APP` for uninstall success).

---

## 4. App uninstall audit test

**Route:** `POST /api/webhooks/app-uninstalled`

### Steps

1. Trigger valid `app/uninstalled` webhook (Shopify test or CLI).
2. Check **AdminAuditLog** and **Merchant** (`isActive` should be `false` if shop exists).

### Expected

| Field | Value |
|-------|-------|
| `eventType` | `APP_UNINSTALLED` |
| `severity` | `WARN` |
| `resourceType` | `SHOPIFY_APP` |
| `message` | `Shopify app uninstalled` |
| `metadata.shopDomain` | Shop domain |
| `metadata.merchantUpdated` | `true` or `false` |

**Pass if:** Row exists; merchant deactivated when shop matches; no access token in metadata.

---

## 5. Unauthorized access audit test

**Routes:** merchant-protected APIs without session cookie

### Steps — merchant action (no session)

```powershell
try {
  Invoke-RestMethod -Method Patch `
    -Uri "$base/api/requests/fake-id/action" `
    -ContentType "application/json" `
    -Body '{"action":"APPROVE"}'
} catch {
  $_.Exception.Response.StatusCode.value__
}
```

Or:

```powershell
$r = Invoke-WebRequest -Method PATCH -Uri "$base/api/requests/fake-id/action" `
  -ContentType "application/json" `
  -Body '{"action":"APPROVE"}' `
  -SkipHttpErrorCheck
$r.StatusCode
($r.Content | ConvertFrom-Json) | Select-Object success, error, code
```

### Steps — Shopify sync (no session)

```powershell
$r = Invoke-WebRequest -Method POST -Uri "$base/api/shopify/orders/sync" `
  -SkipHttpErrorCheck
$r.StatusCode
```

Check **AdminAuditLog** for new `UNAUTHORIZED_ACCESS` rows.

### Expected

| Field | Value |
|-------|-------|
| HTTP status | **401** |
| Response `code` | `UNAUTHORIZED` |
| `eventType` | `UNAUTHORIZED_ACCESS` |
| `severity` | `SECURITY` |
| `resourceType` | `API_ROUTE` |
| `metadata.routeName` | `merchant-action` or `shopify-order-sync` |
| `metadata.reason` | `Missing or invalid merchant session` |

**Pass if:**

- API returns safe 401 (not 500).
- `UNAUTHORIZED_ACCESS` row exists per attempt.
- No `merchant_session` cookie value, session token, or `authorization` header stored.
- `ipAddress` / `userAgent` may be logged.

---

## 6. Security checks

Inspect **AdminAuditLog.metadata** JSON and `message` fields across all test rows.

| # | Must NOT appear |
|---|-----------------|
| 6.1 | `accessToken` / `shopifyAccessToken` / `shpat_` |
| 6.2 | `RESEND_API_KEY` / `re_` key material |
| 6.3 | `SHOPIFY_API_SECRET` |
| 6.4 | `DATABASE_URL` / `postgresql://` |
| 6.5 | `authorization` header values |
| 6.6 | `cookie` values |
| 6.7 | `hmac` digest values |
| 6.8 | `rawBody` or full webhook/request JSON |
| 6.9 | Raw customer PII (email, phone, image data) |

### Prisma Studio quick scan

Open 5–10 recent **AdminAuditLog** rows → expand **metadata**. Search for forbidden patterns above.

**Pass if:** No matches in any column.

---

## 7. Failure behavior

Admin audit logging must not break main API flows (`safeCreateAdminAuditLog` / `logUnauthorizedApiAccess`).

| # | Test | Expected |
|---|------|----------|
| 7.1 | Shopify sync (success or protected-data error) | Sync API responds normally; dashboard unchanged |
| 7.2 | Webhook (valid or invalid HMAC) | Correct 200/401 response |
| 7.3 | Merchant action without session | 401 returned even if audit write fails |
| 7.4 | Audit DB error | Server may log `[AdminAudit] Failed to create admin audit log` only — no user-facing 500 |

### Optional simulation (advanced)

Temporarily break `AdminAuditLog` writes in a local branch and confirm APIs still return expected responses.

**Pass if:** Main flows complete; audit is best-effort only.

---

## AdminAuditLog event reference

| `eventType` | Source |
|-------------|--------|
| `SHOPIFY_SYNC_STARTED` | Shopify sync route |
| `SHOPIFY_SYNC_COMPLETED` | Shopify sync route |
| `SHOPIFY_SYNC_FAILED` | Shopify sync route |
| `SHOPIFY_PROTECTED_CUSTOMER_DATA_REQUIRED` | Shopify sync route |
| `RATE_LIMIT_TRIGGERED` | Shopify sync rate limit |
| `WEBHOOK_RECEIVED` | Webhook routes |
| `WEBHOOK_INVALID_HMAC` | Webhook routes |
| `APP_UNINSTALLED` | App uninstall webhook |
| `CUSTOMERS_DATA_REQUEST` | Compliance webhook |
| `CUSTOMERS_REDACT` | Compliance webhook |
| `SHOP_REDACT` | Compliance webhook |
| `UNAUTHORIZED_ACCESS` | Merchant action, Shopify sync (no session) |

**Still in ReturnEvent (Task 14):** `RETURN_SUBMITTED`, `MERCHANT_ACTION_*`, `EMAIL_SENT`, `EMAIL_FAILED`

---

## Sign-off

| Area | Tester | Date | Pass |
|------|--------|------|------|
| Prisma model | | | ☐ |
| Shopify sync | | | ☐ |
| Webhooks | | | ☐ |
| App uninstall | | | ☐ |
| Unauthorized access | | | ☐ |
| Security | | | ☐ |
| Failure behavior | | | ☐ |

**Related docs**

- [Task 14 — ReturnEvent audit logging](./task-14-audit-logging-test-checklist.md)
- [Task 12 — Error handling](./task-12-error-handling-test-checklist.md)
- [Environment setup](./environment-setup.md)
