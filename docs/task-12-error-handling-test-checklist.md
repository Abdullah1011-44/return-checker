# Task 12 — Error Handling Manual Test Checklist

Manual tests for safe, consistent API error responses and the global App Router error UI.

**Prerequisites**

- Dev server running: `npm run dev` (default `http://localhost:3000`)
- Seeded test data available (`npm run db:seed`)
- Test orders: `1001` / `test1@gmail.com`, `1002` / `test2@gmail.com`
- Merchant dashboard session for merchant-action and Shopify sync tests

```powershell
$base = "http://localhost:3000"
```

**Standard safe error shape**

```json
{
  "success": false,
  "error": "Human-readable message",
  "code": "ERROR_CODE"
}
```

Validation errors use `error: "Invalid request"` plus a `details` array (HTTP 400).

---

## 1. Check-return

**Route:** `POST /api/check-return`

| # | Test | Expected |
|---|------|----------|
| 1.1 | Invalid email format | HTTP **400**, `error: "Invalid request"`, `details` with email path |
| 1.2 | Unknown order (valid email, wrong order number) | HTTP **200**, `orderFound: false`, `orderEligible: false`, safe `message` (no stack/SQL) |
| 1.3 | Unexpected server error | HTTP **500**, `code: "CHECK_RETURN_ERROR"`, no stack trace in JSON |

### PowerShell — invalid email

```powershell
$body = '{"orderNumber":"1001","email":"not-an-email"}'
$r = Invoke-WebRequest -Method POST -Uri "$base/api/check-return" `
  -ContentType "application/json" -Body $body -SkipHttpErrorCheck
$r.StatusCode
($r.Content | ConvertFrom-Json) | ConvertTo-Json -Depth 5
```

**Pass:** Status 400, `error` is `"Invalid request"`, no `stack` or `Prisma` in body.

### PowerShell — unknown order

```powershell
$body = '{"orderNumber":"99999","email":"test1@gmail.com"}'
$r = Invoke-WebRequest -Method POST -Uri "$base/api/check-return" `
  -ContentType "application/json" -Body $body -SkipHttpErrorCheck
($r.Content | ConvertFrom-Json) | Select-Object success, orderFound, orderEligible, message
```

**Pass:** `orderFound: false`, friendly message, no database internals.

### Simulating unexpected error (optional)

1. Stop Postgres or set invalid `DATABASE_URL` in `.env.local`
2. Restart dev server
3. POST a valid check-return body

**Pass:** HTTP 500, `error: "Unable to check return eligibility. Please try again."`, `code: "CHECK_RETURN_ERROR"`. Body must not contain `at `, `node_modules`, or `PrismaClient`.

Restore database before continuing.

---

## 2. Submit-return

**Route:** `POST /api/submit-return`

| # | Test | Expected |
|---|------|----------|
| 2.1 | Invalid payload (missing fields) | HTTP **400**, `error: "Invalid request"` |
| 2.2 | Valid format, unknown order | HTTP **404**, `code: "ORDER_NOT_ELIGIBLE"` |
| 2.3 | Valid return submission | HTTP **200**, `success: true`, return request created |

### PowerShell — invalid payload

```powershell
$body = '{"orderNumber":"1001"}'
$r = Invoke-WebRequest -Method POST -Uri "$base/api/submit-return" `
  -ContentType "application/json" -Body $body -SkipHttpErrorCheck
$r.StatusCode
($r.Content | ConvertFrom-Json).error
```

### PowerShell — unknown order

```powershell
$body = @{
  orderNumber        = "99999"
  email              = "test1@gmail.com"
  returnRequestItems = @(@{
    sku            = "TEE-BLU-M"
    returnReason   = "wrong_size"
    selectedOption = "Exchange Product"
  })
} | ConvertTo-Json -Depth 5

$r = Invoke-WebRequest -Method POST -Uri "$base/api/submit-return" `
  -ContentType "application/json" -Body $body -SkipHttpErrorCheck
$r.StatusCode
($r.Content | ConvertFrom-Json) | Select-Object success, error, code
```

**Pass:** 404, `error: "Order not found or not eligible for return"`, `code: "ORDER_NOT_ELIGIBLE"`.

### Valid submission

Use the customer portal UI or a full payload with real `itemId` / `sku` from a seeded order.

**Pass:** `success: true`, `message: "Return request submitted successfully."`

---

## 3. Merchant action

**Route:** `PATCH /api/requests/{id}/action`

| # | Test | Expected |
|---|------|----------|
| 3.1 | No merchant session | HTTP **401**, `code: "UNAUTHORIZED"` |
| 3.2 | Invalid action body | HTTP **400**, `error: "Invalid request"` |
| 3.3 | Valid ID format, request not found | HTTP **404**, `code: "RETURN_REQUEST_NOT_FOUND"` |
| 3.4 | Email fails after successful DB update | HTTP **200**, `success: true`, `email.sent: false`, `email.error: "Email notification failed"` |

### PowerShell — no session (401)

```powershell
$r = Invoke-WebRequest -Method PATCH -Uri "$base/api/requests/some-id/action" `
  -ContentType "application/json" `
  -Body '{"action":"APPROVE"}' `
  -SkipHttpErrorCheck
($r.Content | ConvertFrom-Json) | Select-Object success, error, code
```

### PowerShell — invalid action (400)

Requires merchant session cookie:

```powershell
$headers = @{
  "Content-Type" = "application/json"
  Cookie         = "merchant_session=PASTE_SESSION_COOKIE"
}
$r = Invoke-WebRequest -Method PATCH -Uri "$base/api/requests/PASTE_REQUEST_ID/action" `
  -Headers $headers -Body '{"action":"INVALID_ACTION"}' -SkipHttpErrorCheck
$r.StatusCode
($r.Content | ConvertFrom-Json).error
```

### PowerShell — missing request (404)

```powershell
$r = Invoke-WebRequest -Method PATCH -Uri "$base/api/requests/00000000-0000-0000-0000-000000000001/action" `
  -Headers $headers -Body '{"action":"APPROVE"}' -SkipHttpErrorCheck
($r.Content | ConvertFrom-Json) | Select-Object success, error, code
```

**Pass:** 404, `error: "Return request not found"`, `code: "RETURN_REQUEST_NOT_FOUND"`.

### Email failure without rollback

1. Remove or invalidate `RESEND_API_KEY` / `EMAIL_FROM` in `.env.local`
2. Restart dev server
3. Approve or reject a return from the dashboard (or API with session)

**Pass:**

- Return status updates in dashboard (action not rolled back)
- Response `success: true`
- `email: { sent: false, error: "Email notification failed" }`
- No `RESEND_API_KEY` in response or server logs visible to client

Restore email env vars after test.

---

## 4. Shopify sync

**Route:** `POST /api/shopify/orders/sync`

| # | Test | Expected |
|---|------|----------|
| 4.1 | Protected customer data not approved | HTTP **403**, `code: "SHOPIFY_PROTECTED_CUSTOMER_DATA_REQUIRED"`, `nextStep` present |
| 4.2 | 6+ syncs within 5 minutes | HTTP **429** from rate limiter (Task 11) |
| 4.3 | Any error response | No `accessToken`, `shopifyAccessToken`, or `shpat_` in JSON |

### Protected customer data

Click **Sync Shopify Orders** on dashboard (merchant with Shopify connected, protected data not yet approved).

**Pass:** Response includes:

```json
{
  "success": false,
  "code": "SHOPIFY_PROTECTED_CUSTOMER_DATA_REQUIRED",
  "error": "Shopify connection works, but order sync requires protected customer data access approval...",
  "nextStep": "Go to Shopify Partner Dashboard..."
}
```

### Rate limit (429)

Repeat sync more than 5 times in 5 minutes (see [Task 11 checklist](./task-11-rate-limiting-test-checklist.md)).

**Pass:** HTTP 429 with `error: "Too many requests"` — not a raw Shopify error.

### Token leak check

```powershell
$headers = @{ Cookie = "merchant_session=PASTE_SESSION_COOKIE" }
$r = Invoke-WebRequest -Method POST -Uri "$base/api/shopify/orders/sync" `
  -Headers $headers -SkipHttpErrorCheck
$r.Content | Select-String -Pattern "accessToken|shopifyAccessToken|shpat_"
```

**Pass:** No matches.

---

## 5. Webhooks

**Routes:** `/api/webhooks/*`

| # | Test | Expected |
|---|------|----------|
| 5.1 | Invalid HMAC | HTTP **401**, `code: "INVALID_WEBHOOK_HMAC"` |
| 5.2 | Server logs | No raw webhook body or customer email in terminal |
| 5.3 | Valid HMAC (if testable) | HTTP **200**, `success: true`, topic acknowledged |

### PowerShell — invalid HMAC

```powershell
$r = Invoke-WebRequest -Method POST -Uri "$base/api/webhooks/app-uninstalled" `
  -ContentType "application/json" `
  -Body '{"shop_domain":"test.myshopify.com"}' `
  -Headers @{ "X-Shopify-Hmac-Sha256" = "invalid" } `
  -SkipHttpErrorCheck
$r.StatusCode
($r.Content | ConvertFrom-Json) | Select-Object success, error, code
```

**Pass:**

```json
{
  "success": false,
  "error": "Unauthorized",
  "code": "INVALID_WEBHOOK_HMAC"
}
```

### Log inspection

Trigger invalid and valid webhook attempts; watch the dev server terminal.

**Pass:** Logs may show `route`, `topic`, `shopDomain`, `webhookId` — not full JSON body, not `SHOPIFY_API_SECRET`, not HMAC value.

### Unexpected webhook error (500)

**Pass if triggered:** `error: "Webhook processing failed"`, `code: "WEBHOOK_ERROR"`, no stack in JSON.

---

## 6. Frontend error UI

**File:** `src/app/error.js`

| # | Test | Expected |
|---|------|----------|
| 6.1 | File exists | `src/app/error.js` with `"use client"` |
| 6.2 | UI copy | Shows "Something went wrong" and "Please refresh the page or try again." |
| 6.3 | Try again button | Calls `reset()` |
| 6.4 | No sensitive render | Page does not show `error.stack`, raw error message, or env values |

### Manual UI test (development)

Temporarily add `throw new Error("test secret shpat_abc123")` inside a page component, load that page, then remove the throw.

**Pass:**

- Friendly error card appears (not Next.js red overlay with stack)
- Browser page source / visible text has no stack trace or test secret
- Dev terminal may show `console.error` (development only)

---

## 7. Security checks

Run after any error-triggering test above.

| # | Check | Pass if |
|---|--------|---------|
| 7.1 | No access tokens | Response bodies contain no `accessToken`, `shopifyAccessToken`, `shpat_` |
| 7.2 | No email API key | No `RESEND_API_KEY` or `re_` key material |
| 7.3 | No Shopify secret | No `SHOPIFY_API_SECRET` |
| 7.4 | No database URL | No `postgresql://`, `DATABASE_URL`, or `PrismaClientKnownRequestError` |
| 7.5 | No stack traces | No `at ` lines, `node_modules`, or `"stack"` field in JSON |
| 7.6 | No env dump | No `process.env` in responses |

### PowerShell grep helper

Save a few error response bodies to `$content`, then:

```powershell
$patterns = @(
  "accessToken",
  "shopifyAccessToken",
  "shpat_",
  "RESEND_API_KEY",
  "SHOPIFY_API_SECRET",
  "postgresql://",
  "DATABASE_URL",
  "PrismaClient",
  "node_modules",
  "process\.env",
  "`"stack`""
)
foreach ($pattern in $patterns) {
  if ($content | Select-String -Pattern $pattern) {
    Write-Host "FAIL: matched $pattern"
  }
}
```

---

## Error code reference

| Route | Code | HTTP | When |
|-------|------|------|------|
| `check-return` | `CHECK_RETURN_ERROR` | 500 | Unexpected failure |
| `submit-return` | `ORDER_NOT_ELIGIBLE` | 404 | Order not found |
| `submit-return` | `SUBMIT_RETURN_ERROR` | 500 | Unexpected failure |
| `merchant-action` | `UNAUTHORIZED` | 401 | No session |
| `merchant-action` | `RETURN_REQUEST_NOT_FOUND` | 404 | Unknown request ID |
| `merchant-action` | `MERCHANT_ACTION_ERROR` | 500 | Unexpected failure |
| `shopify/orders/sync` | `SHOPIFY_PROTECTED_CUSTOMER_DATA_REQUIRED` | 403 | Protected data not approved |
| `shopify/orders/sync` | `SHOPIFY_SYNC_ERROR` | 500 | Unexpected failure |
| `webhooks/*` | `INVALID_WEBHOOK_HMAC` | 401 | Bad signature |
| `webhooks/*` | `WEBHOOK_ERROR` | 500 | Unexpected failure |
| Validation (all) | — | 400 | `error: "Invalid request"` |

---

## Sign-off

| Area | Tester | Date | Pass |
|------|--------|------|------|
| Check-return | | | ☐ |
| Submit-return | | | ☐ |
| Merchant action | | | ☐ |
| Shopify sync | | | ☐ |
| Webhooks | | | ☐ |
| Frontend error UI | | | ☐ |
| Security | | | ☐ |

**Related docs**

- [Task 9 — API validation](./task-9-api-validation-test-checklist.md)
- [Task 11 — Rate limiting](./task-11-rate-limiting-test-checklist.md)
- [Environment setup](./environment-setup.md)
