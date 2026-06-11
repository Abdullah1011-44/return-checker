# Task 14 — Audit Logging Manual Test Checklist

Manual tests for `ReturnEvent` persistence and safe console audit logs (`logAuditInfo`).

**Prerequisites**

- Dev server running: `npm run dev` (default `http://localhost:3000`)
- Database seeded: `npm run db:seed`
- Test customer order: `1001` / `test1@gmail.com`
- Merchant dashboard session for action and sync tests
- Prisma Studio (optional): `npx prisma studio`

```powershell
$base = "http://localhost:3000"
```

**Audit helpers**

- `src/lib/audit.js` — `safeCreateAuditEvent`, `logAuditInfo`, `sanitizeAuditMetadata`
- Return-request events → `ReturnEvent` table (requires `returnRequestId`)
- Merchant/system events (Shopify sync, webhooks) → terminal `[Audit]` logs only

---

## 1. Customer return submission test

**Route:** `POST /api/submit-return`  
**Helper:** `safeCreateAuditEvent` with `AUDIT_EVENTS.RETURN_SUBMITTED`

### Steps

1. Open customer portal: `http://localhost:3000`
2. Submit a valid return for order `1001` / `test1@gmail.com` (one or more items).
3. Confirm success message in UI.
4. Open Prisma Studio:

```powershell
npx prisma studio
```

5. Open **ReturnEvent** table.
6. Filter by the new `returnRequestId` (from response or **ReturnRequest** table).
7. Find the latest row with `eventType = RETURN_SUBMITTED`.

### Expected

| Field | Expected value |
|-------|----------------|
| `eventType` | `RETURN_SUBMITTED` |
| `actorType` | `CUSTOMER` |
| `toValue` | `PENDING` (or current request status) |
| `note` | `Customer submitted return request` |
| `metadata.orderNumber` | Order number (e.g. `1001`) |
| `metadata.itemCount` | Number of items submitted |
| `metadata.selectedOptions` | Array of selected recovery options |
| `metadata.reasons` | Array of return reasons |
| `metadata.hasImages` | `true` or `false` |

**Pass if:**

- ReturnEvent row exists.
- Metadata has safe summary fields only.
- No `accessToken`, `proofImage`, base64 image data, cookies, or raw request body in `metadata`.
- Submission succeeded even if audit were to fail (`safeCreateAuditEvent` is non-blocking).

---

## 2. Merchant action test

**Route:** `PATCH /api/requests/{id}/action`  
**Helper:** `safeCreateAuditEvent` with `MERCHANT_ACTION_*` events

### Steps

1. Open dashboard: `http://localhost:3000/dashboard`
2. Pick a pending return request.
3. Perform one action: **Approve**, **Reject**, **Needs more info**, or **Resolve**.
4. In Prisma Studio → **ReturnEvent**, filter by that `returnRequestId`.
5. Find the newest merchant action event.

### Expected event types

| Dashboard action | `eventType` |
|------------------|-------------|
| Approve | `MERCHANT_ACTION_APPROVE` |
| Reject | `MERCHANT_ACTION_REJECT` |
| Needs more info | `MERCHANT_ACTION_NEEDS_MORE_INFO` |
| Resolve | `MERCHANT_ACTION_RESOLVE` |

| Field | Expected |
|-------|----------|
| `actorType` | `MERCHANT` |
| `fromValue` | Previous status (e.g. `PENDING`, `IN_REVIEW`) |
| `toValue` | New status (e.g. `APPROVED`, `REJECTED`, `RESOLVED`) |
| `note` | Merchant note text, or safe default like `Merchant action: Approved` |
| `metadata.action` | `APPROVE`, `REJECT`, `NEEDS_MORE_INFO`, or `RESOLVE` |
| `metadata.itemDecisionCount` | Number of return items |
| `metadata.hasMerchantNote` | `true` or `false` |

**Pass if:**

- Correct `MERCHANT_ACTION_*` event exists per action.
- `fromValue` / `toValue` reflect status transition.
- Note is human-readable, not a stack trace or raw API response.
- No secrets in `metadata`.

Repeat for each action type you need to verify.

---

## 3. Email audit test

**Route:** `PATCH /api/requests/{id}/action` (with email notification)  
**Helper:** `safeCreateAuditEvent` with `EMAIL_SENT` or `EMAIL_FAILED`

### Steps — success path

1. Ensure `RESEND_API_KEY` and `EMAIL_FROM` are set in `.env.local`.
2. Approve or reject a return that triggers customer email.
3. Check **ReturnEvent** for the same `returnRequestId`.

### Steps — failure path (optional)

1. Remove or invalidate `RESEND_API_KEY` in `.env.local`.
2. Restart dev server.
3. Perform a merchant action that sends email.
4. Confirm dashboard still shows action success (email warning only).
5. Check **ReturnEvent** for `EMAIL_FAILED`.

### Expected

| Outcome | `eventType` | `metadata` |
|---------|-------------|------------|
| Email sent | `EMAIL_SENT` | `{ provider: "resend", action, recipientType: "customer" }` |
| Email failed | `EMAIL_FAILED` | Above plus safe `reason` (e.g. `EMAIL_CONFIG_MISSING`, `EMAIL_SEND_FAILED`) |

**Pass if:**

- `EMAIL_SENT` or `EMAIL_FAILED` row exists.
- `metadata.provider` is `"resend"`.
- No `RESEND_API_KEY`, raw provider response, or customer email address in metadata.
- Merchant action was **not** rolled back when email failed.

---

## 4. Shopify sync audit log test

**Route:** `POST /api/shopify/orders/sync`  
**Helper:** `logAuditInfo` (console only — no `ReturnEvent`)

### Steps

1. Log in to merchant dashboard with Shopify-connected merchant.
2. Watch the terminal running `npm run dev`.
3. Click **Sync Shopify Orders** once.
4. Optionally click repeatedly to trigger protected-data or failure paths.

### Expected terminal logs

| Scenario | Log prefix | Event |
|----------|------------|-------|
| Sync begins | `[Audit]` | `SHOPIFY_SYNC_STARTED` |
| Sync succeeds | `[Audit]` | `SHOPIFY_SYNC_COMPLETED` with `createdOrders`, `updatedOrders`, `syncedItems` |
| Protected data blocked | `[Audit]` | `SHOPIFY_PROTECTED_CUSTOMER_DATA_REQUIRED` with `httpStatus: 403`, `code` |
| Other failure | `[Audit]` | `SHOPIFY_SYNC_FAILED` with safe `code`, `httpStatus` |

**Safe fields you may see:**

- `merchantId`
- `shopDomain`
- `hasToken: true` or `hasToken: false`
- `endpoint` (path only, on protected-data error)
- Sync counts on success

**Pass if:**

- `[Audit] SHOPIFY_SYNC_STARTED` appears on each sync attempt (after auth).
- Protected data scenario logs `SHOPIFY_PROTECTED_CUSTOMER_DATA_REQUIRED`.
- Logs never include actual `shopifyAccessToken`, `shpat_*`, or full Shopify response body.
- No `ReturnEvent` row is created for sync (merchant-level activity).

---

## 5. Webhook audit log test

**Routes:** `/api/webhooks/*`  
**Helper:** `logAuditInfo` via `shopifyComplianceWebhook.js`

### Steps — invalid HMAC

```powershell
$r = Invoke-WebRequest -Method POST -Uri "$base/api/webhooks/app-uninstalled" `
  -ContentType "application/json" `
  -Body '{"shop_domain":"test.myshopify.com"}' `
  -Headers @{ "X-Shopify-Hmac-Sha256" = "invalid" } `
  -SkipHttpErrorCheck
$r.StatusCode
```

Watch dev server terminal during the request.

### Steps — valid webhook (if available)

Use Shopify CLI webhook trigger or Partner Dashboard test delivery for `app/uninstalled`.

### Expected

| Scenario | HTTP | Terminal `[Audit]` event |
|----------|------|--------------------------|
| Request received | — | `WEBHOOK_RECEIVED` with `routeName`, `topic`, `shopDomain` |
| Bad HMAC | **401** | `WEBHOOK_INVALID_HMAC` with `reason: "Invalid HMAC"` |
| App uninstall success | **200** | `APP_UNINSTALLED` with `shopDomain`, `merchantUpdated` |

**Pass if:**

- `WEBHOOK_RECEIVED` logged before HMAC check completes.
- Invalid HMAC returns `{ code: "INVALID_WEBHOOK_HMAC" }` and logs `WEBHOOK_INVALID_HMAC`.
- Terminal does **not** print raw JSON body, HMAC header value, or `SHOPIFY_API_SECRET`.
- Valid compliance webhooks still return `{ success: true, topic: "..." }`.

---

## 6. Security checks

After running tests above, inspect **ReturnEvent.metadata** (Prisma Studio) and terminal `[Audit]` logs.

| # | Must NOT appear |
|---|-----------------|
| 6.1 | `accessToken` / `shopifyAccessToken` / `shpat_` |
| 6.2 | `RESEND_API_KEY` / `re_` key material |
| 6.3 | `SHOPIFY_API_SECRET` |
| 6.4 | `DATABASE_URL` / `postgresql://` |
| 6.5 | `authorization` header values |
| 6.6 | `cookie` values |
| 6.7 | `rawBody` or full webhook JSON |
| 6.8 | Base64 / raw customer image data |
| 6.9 | HMAC digest values |

### Prisma Studio quick check

Open any recent **ReturnEvent** → **metadata** JSON column. Search visually for the patterns above.

### Terminal quick check

```powershell
# After sync + webhook tests, scan recent terminal output mentally for forbidden patterns
```

**Pass if:** No matches in persisted metadata or `[Audit]` log output.

---

## 7. Failure behavior

Audit logging must never break the main user flow.

| # | Test | Expected |
|---|------|----------|
| 7.1 | Customer return submission | `success: true` even if audit DB write fails |
| 7.2 | Merchant approve/reject | Dashboard updates; action not rolled back |
| 7.3 | Email send failure | `success: true` with email warning; `EMAIL_FAILED` audit optional |
| 7.4 | Audit DB error | Console shows `[Audit] Failed to create audit event` only — no 500 to user |

### Optional simulation (advanced)

Temporarily break audit writes (e.g. invalid `returnRequestId` in a local test branch) and confirm `safeCreateAuditEvent` swallows the error.

**Pass if:** Main flows complete; only `[Audit] Failed to create audit event` appears server-side.

---

## Event reference

### ReturnEvent (`safeCreateAuditEvent`)

| Event | When |
|-------|------|
| `RETURN_SUBMITTED` | Customer submits return |
| `MERCHANT_ACTION_APPROVE` | Merchant approves |
| `MERCHANT_ACTION_REJECT` | Merchant rejects |
| `MERCHANT_ACTION_NEEDS_MORE_INFO` | Merchant requests info |
| `MERCHANT_ACTION_RESOLVE` | Merchant resolves |
| `EMAIL_SENT` | Customer notification sent |
| `EMAIL_FAILED` | Customer notification failed |

### Console only (`logAuditInfo`)

| Event | When |
|-------|------|
| `SHOPIFY_SYNC_STARTED` | Sync begins |
| `SHOPIFY_SYNC_COMPLETED` | Sync succeeds |
| `SHOPIFY_SYNC_FAILED` | Sync fails |
| `SHOPIFY_PROTECTED_CUSTOMER_DATA_REQUIRED` | Protected data not approved |
| `WEBHOOK_RECEIVED` | Webhook request received |
| `WEBHOOK_INVALID_HMAC` | HMAC verification failed |
| `APP_UNINSTALLED` | App uninstall handled |

---

## Sign-off

| Area | Tester | Date | Pass |
|------|--------|------|------|
| Customer submission | | | ☐ |
| Merchant action | | | ☐ |
| Email audit | | | ☐ |
| Shopify sync logs | | | ☐ |
| Webhook logs | | | ☐ |
| Security | | | ☐ |
| Failure behavior | | | ☐ |

**Related docs**

- [Task 12 — Error handling](./task-12-error-handling-test-checklist.md)
- [Task 11 — Rate limiting](./task-11-rate-limiting-test-checklist.md)
- [Environment setup](./environment-setup.md)
