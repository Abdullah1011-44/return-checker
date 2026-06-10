# Task 11 — Rate Limiting Manual Test Checklist

Manual tests for in-memory rate limiting on core API routes.

**Prerequisites**

- Dev server running: `npm run dev` (default `http://localhost:3000`)
- Rate limits are **per IP** (from `x-forwarded-for` / `x-real-ip`, or `"unknown"` locally)
- Limits reset after their time window expires
- MVP limiter is in-memory — restarting the dev server clears counters

```powershell
$base = "http://localhost:3000"
```

**Expected 429 response shape**

```json
{
  "success": false,
  "error": "Too many requests",
  "retryAfter": 42
}
```

Headers should include `Retry-After`, `X-RateLimit-Remaining`, `X-RateLimit-Reset` (and `X-RateLimit-Limit` when set).

---

## 1. Check-return rate limit

**Route:** `POST /api/check-return`  
**Limit:** 20 requests per 60 seconds per IP  
**Route key:** `check-return:{ip}`

| # | Test | Expected |
|---|------|----------|
| 1.1 | Send 1–19 valid requests in 1 minute | HTTP 200 (or normal not-found), not 429 |
| 1.2 | Send 21+ valid requests in 1 minute | HTTP **429** after the 20th allowed request |
| 1.3 | Wait for window to expire, send again | HTTP 200 again |

### PowerShell rapid test

```powershell
$body = '{"orderNumber":"1001","email":"test1@gmail.com"}'

1..25 | ForEach-Object {
  $i = $_
  try {
    $response = Invoke-WebRequest -Method POST -Uri "$base/api/check-return" `
      -ContentType "application/json" -Body $body -SkipHttpErrorCheck
    Write-Host "Request $i : $($response.StatusCode)"
  } catch {
    Write-Host "Request $i : error"
  }
}
```

**Pass criteria:** First ~20 return non-429; later requests return **429** with `error: "Too many requests"`.

### Single 429 inspection

```powershell
# After triggering limit, inspect one response (no IP in JSON body)
$r = Invoke-WebRequest -Method POST -Uri "$base/api/check-return" `
  -ContentType "application/json" -Body $body -SkipHttpErrorCheck
$r.StatusCode
$r.Headers["Retry-After"]
$r.Content | ConvertFrom-Json | ConvertTo-Json
```

---

## 2. Submit-return rate limit

**Route:** `POST /api/submit-return`  
**Limit:** 10 requests per 60 seconds per IP  
**Route key:** `submit-return:{ip}`

| # | Test | Expected |
|---|------|----------|
| 2.1 | Send 1–9 valid submissions in 1 minute | Normal response (200 or validation/order errors), not 429 |
| 2.2 | Send 11+ requests in 1 minute | HTTP **429** after the 10th allowed request |
| 2.3 | Invalid body before limit | Still HTTP **400** validation error (not 429) if under limit |

### PowerShell example

Replace `itemId` / `sku` with real values from a seeded order.

```powershell
$payload = @{
  orderNumber        = "1001"
  email              = "test1@gmail.com"
  returnRequestItems = @(@{
    itemId         = "REPLACE_ORDER_ITEM_ID"
    sku            = "TEE-BLU-M"
    returnReason   = "wrong_size"
    selectedOption = "Exchange Product"
  })
} | ConvertTo-Json -Depth 5

1..15 | ForEach-Object {
  $r = Invoke-WebRequest -Method POST -Uri "$base/api/submit-return" `
    -ContentType "application/json" -Body $payload -SkipHttpErrorCheck
  Write-Host "Request $_ : $($r.StatusCode)"
}
```

**Pass criteria:** 429 after 10 allowed requests in the window.

---

## 3. Merchant-action rate limit

**Route:** `PATCH /api/requests/{id}/action`  
**Limit:** 30 requests per 60 seconds per IP  
**Route key:** `merchant-action:{ip}`

| # | Test | Expected |
|---|------|----------|
| 3.1 | Approve/reject/resolve from dashboard repeatedly | Works until limit |
| 3.2 | 31+ actions in 1 minute (API or UI) | HTTP **429** |
| 3.3 | Under limit, invalid action body | HTTP **400** validation (not 429) |
| 3.4 | Email still attempts on successful action under limit | `email.sent` in response |

### PowerShell example

Requires merchant session cookie and a real return request ID.

```powershell
$sessionCookie = "PASTE_MERCHANT_SESSION_COOKIE"
$requestId = "PASTE_RETURN_REQUEST_ID"
$headers = @{
  "Content-Type" = "application/json"
  Cookie         = "merchant_session=$sessionCookie"
}

1..35 | ForEach-Object {
  $r = Invoke-WebRequest -Method PATCH -Uri "$base/api/requests/$requestId/action" `
    -Headers $headers -Body '{"action":"NEEDS_MORE_INFO","merchantNote":"rate test"}' `
    -SkipHttpErrorCheck
  Write-Host "Request $_ : $($r.StatusCode)"
}
```

**Pass criteria:** 429 after 30 allowed requests; auth and validation behavior unchanged when under limit.

---

## 4. Shopify order sync rate limit

**Route:** `POST /api/shopify/orders/sync`  
**Limit:** 5 requests per 5 minutes per IP  
**Route key:** `shopify-order-sync:{ip}`

| # | Test | Expected |
|---|------|----------|
| 4.1 | Click **Sync Shopify Orders** up to 5 times in 5 minutes | Sync runs (or protected-data 403 if pending approval) |
| 4.2 | 6th sync within 5 minutes | HTTP **429** |
| 4.3 | Body with `merchantId` ignored | Still syncs session merchant only |
| 4.4 | Protected customer data blocker | Still returns `code: "SHOPIFY_PROTECTED_CUSTOMER_DATA_REQUIRED"` when applicable (not replaced by 429 unless rate limited) |

### PowerShell example

```powershell
$headers = @{ Cookie = "merchant_session=$sessionCookie" }

1..8 | ForEach-Object {
  $r = Invoke-WebRequest -Method POST -Uri "$base/api/shopify/orders/sync" `
    -Headers $headers -SkipHttpErrorCheck
  Write-Host "Sync $_ : $($r.StatusCode)"
  ($r.Content | ConvertFrom-Json).error
}
```

**Pass criteria:** 429 on 6th attempt within 5 minutes; dashboard shows safe error, not token leakage.

---

## 5. Webhook rate limit

**Routes:** `/api/webhooks/*`  
**Limit:** 100 requests per 60 seconds per IP (per route name)

| Route | `routeName` |
|-------|-------------|
| App uninstall | `webhook-app-uninstalled` |
| Customers data request | `webhook-customers-data-request` |
| Customers redact | `webhook-customers-redact` |
| Shop redact | `webhook-shop-redact` |

| # | Test | Expected |
|---|------|----------|
| 5.1 | POST without valid HMAC (under limit) | HTTP **401** `Invalid webhook HMAC` |
| 5.2 | POST with valid HMAC from Shopify | HTTP **200** acknowledgment |
| 5.3 | 100+ abusive POSTs/minute to same webhook | HTTP **429** (rare in normal Shopify traffic) |
| 5.4 | HMAC verification still runs after rate limit check passes | Invalid HMAC never processes body as trusted |

### PowerShell bad-HMAC smoke test

```powershell
$r = Invoke-WebRequest -Method POST -Uri "$base/api/webhooks/app-uninstalled" `
  -ContentType "application/json" `
  -Body '{"shop_domain":"test.myshopify.com"}' `
  -Headers @{ "X-Shopify-Hmac-Sha256" = "invalid" } `
  -SkipHttpErrorCheck
$r.StatusCode   # Expect 401, not 200
```

**Pass criteria:** HMAC remains primary control; light rate limit does not bypass verification.

---

## 6. Security checks

| # | Check | Pass if |
|---|--------|---------|
| 6.1 | No IP in 429 JSON body | Response has no `ip`, `clientIp`, or email fields |
| 6.2 | No secrets in 429 response | No `RESEND_API_KEY`, `SHOPIFY_API_SECRET`, `accessToken`, or `shopifyAccessToken` |
| 6.3 | No stack traces | Body does not contain `at ` lines or `node_modules` |
| 6.4 | Valid requests before limit | First N requests succeed normally |
| 6.5 | Retry-After header | Present on 429, numeric seconds |

### Quick grep on 429 body

```powershell
$content = (Invoke-WebRequest -Method POST -Uri "$base/api/check-return" `
  -ContentType "application/json" -Body '{"orderNumber":"1001","email":"test1@gmail.com"}' `
  -SkipHttpErrorCheck).Content

$content | Select-String -Pattern "accessToken|RESEND|SHOPIFY_API_SECRET|stack|node_modules|clientIp"
# Should return no matches
```

---

## Rate limit summary

| Route | Limit | Window |
|-------|-------|--------|
| `POST /api/check-return` | 20 | 1 minute |
| `POST /api/submit-return` | 10 | 1 minute |
| `PATCH /api/requests/[id]/action` | 30 | 1 minute |
| `POST /api/shopify/orders/sync` | 5 | 5 minutes |
| `POST /api/webhooks/*` | 100 | 1 minute |

---

## Sign-off

| Area | Tester | Date | Pass |
|------|--------|------|------|
| Check-return | | | ☐ |
| Submit-return | | | ☐ |
| Merchant-action | | | ☐ |
| Shopify sync | | | ☐ |
| Webhooks | | | ☐ |
| Security | | | ☐ |

**Notes**

- In-memory limits do not share state across multiple server instances. Use Redis/Upstash for production multi-instance deployments.
- Restarting `npm run dev` resets all counters.
- Related: [Task 9 API validation checklist](./task-9-api-validation-test-checklist.md) · [Environment setup](./environment-setup.md)
