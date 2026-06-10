# Task 9 — API Validation Manual Test Checklist

Manual tests for Zod validation on core API routes.

**Prerequisites**

- Dev server running: `npm run dev` (default `http://localhost:3000`)
- PowerShell examples below use `$base = "http://localhost:3000"`
- Validation failures should return **HTTP 400** with:

```json
{
  "success": false,
  "error": "Invalid request",
  "details": [{ "path": "...", "message": "..." }]
}
```

- For merchant routes, log in via Shopify OAuth first and copy the `merchant_session` cookie value into `$sessionCookie` (browser DevTools → Application → Cookies).

```powershell
$base = "http://localhost:3000"
$sessionCookie = "PASTE_MERCHANT_SESSION_COOKIE_HERE"
$merchantHeaders = @{
  "Content-Type" = "application/json"
  Cookie         = "merchant_session=$sessionCookie"
}
```

---

## 1. Check Return API

**Route:** `POST /api/check-return`

| # | Test | Body | Expected |
|---|------|------|----------|
| 1.1 | Missing email | `{ "orderNumber": "1001" }` | 400, `error: "Invalid request"`, details mention `email` |
| 1.2 | Invalid email | `{ "orderNumber": "1001", "email": "not-an-email" }` | 400, invalid email message |
| 1.3 | Missing orderNumber | `{ "email": "test1@gmail.com" }` | 400, details mention `orderNumber` |
| 1.4 | Empty body | `{}` or invalid JSON | 400 |
| 1.5 | Valid body | `{ "orderNumber": "1001", "email": "test1@gmail.com" }` | 200, `orderFound` true/false (not 400) |

### PowerShell examples

```powershell
# 1.1 Missing email
Invoke-RestMethod -Method POST -Uri "$base/api/check-return" `
  -ContentType "application/json" `
  -Body '{"orderNumber":"1001"}' `
  -SkipHttpErrorCheck | ConvertTo-Json -Depth 5

# 1.2 Invalid email
Invoke-RestMethod -Method POST -Uri "$base/api/check-return" `
  -ContentType "application/json" `
  -Body '{"orderNumber":"1001","email":"not-an-email"}' `
  -SkipHttpErrorCheck | ConvertTo-Json -Depth 5

# 1.3 Missing orderNumber
Invoke-RestMethod -Method POST -Uri "$base/api/check-return" `
  -ContentType "application/json" `
  -Body '{"email":"test1@gmail.com"}' `
  -SkipHttpErrorCheck | ConvertTo-Json -Depth 5

# 1.4 Empty body
Invoke-RestMethod -Method POST -Uri "$base/api/check-return" `
  -ContentType "application/json" `
  -Body '{}' `
  -SkipHttpErrorCheck | ConvertTo-Json -Depth 5

# 1.5 Valid body
Invoke-RestMethod -Method POST -Uri "$base/api/check-return" `
  -ContentType "application/json" `
  -Body '{"orderNumber":"1001","email":"test1@gmail.com"}' | ConvertTo-Json -Depth 5
```

**Pass criteria:** Invalid requests never reach DB lookup; valid request returns eligibility payload (not validation error).

---

## 2. Submit Return API

**Route:** `POST /api/submit-return`

Use a real `itemId` or `sku` from a seeded/synced order after a successful check-return.

| # | Test | Expected |
|---|------|----------|
| 2.1 | Empty selected items | `{ "orderNumber":"1001", "email":"test1@gmail.com", "returnRequestItems": [] }` → 400 |
| 2.2 | Missing reason | Item without `returnReason` → 400 |
| 2.3 | Missing selected option | Item without `selectedOption` → 400 |
| 2.4 | Invalid email | `"email": "bad"` → 400 |
| 2.5 | Too long comment | `comment` > 1000 chars → 400 |
| 2.6 | Valid submission | Full valid payload → 200, `success: true` |

### PowerShell examples

```powershell
$validItem = @{
  itemId         = "REPLACE_WITH_REAL_ORDER_ITEM_ID"
  sku            = "TEE-BLU-M"
  returnReason   = "wrong_size"
  selectedOption = "Exchange Product"
  comment        = "Too small"
}

# 2.1 Empty items
Invoke-RestMethod -Method POST -Uri "$base/api/submit-return" `
  -ContentType "application/json" `
  -Body (@{
    orderNumber        = "1001"
    email              = "test1@gmail.com"
    returnRequestItems = @()
  } | ConvertTo-Json) `
  -SkipHttpErrorCheck | ConvertTo-Json -Depth 5

# 2.2 Missing reason
Invoke-RestMethod -Method POST -Uri "$base/api/submit-return" `
  -ContentType "application/json" `
  -Body (@{
    orderNumber        = "1001"
    email              = "test1@gmail.com"
    returnRequestItems = @(@{ itemId = $validItem.itemId; sku = $validItem.sku; selectedOption = "Exchange Product" })
  } | ConvertTo-Json) `
  -SkipHttpErrorCheck | ConvertTo-Json -Depth 5

# 2.3 Missing selected option
Invoke-RestMethod -Method POST -Uri "$base/api/submit-return" `
  -ContentType "application/json" `
  -Body (@{
    orderNumber        = "1001"
    email              = "test1@gmail.com"
    returnRequestItems = @(@{ itemId = $validItem.itemId; sku = $validItem.sku; returnReason = "wrong_size" })
  } | ConvertTo-Json) `
  -SkipHttpErrorCheck | ConvertTo-Json -Depth 5

# 2.4 Invalid email
Invoke-RestMethod -Method POST -Uri "$base/api/submit-return" `
  -ContentType "application/json" `
  -Body (@{
    orderNumber        = "1001"
    email              = "not-valid"
    returnRequestItems = @($validItem)
  } | ConvertTo-Json) `
  -SkipHttpErrorCheck | ConvertTo-Json -Depth 5

# 2.5 Too long comment
$longComment = "x" * 1001
Invoke-RestMethod -Method POST -Uri "$base/api/submit-return" `
  -ContentType "application/json" `
  -Body (@{
    orderNumber        = "1001"
    email              = "test1@gmail.com"
    returnRequestItems = @(@{ itemId = $validItem.itemId; sku = $validItem.sku; returnReason = "wrong_size"; selectedOption = "Exchange Product"; comment = $longComment })
  } | ConvertTo-Json) `
  -SkipHttpErrorCheck | ConvertTo-Json -Depth 5

# 2.6 Valid submission
Invoke-RestMethod -Method POST -Uri "$base/api/submit-return" `
  -ContentType "application/json" `
  -Body (@{
    orderNumber        = "1001"
    email              = "test1@gmail.com"
    returnRequestItems = @($validItem)
  } | ConvertTo-Json) | ConvertTo-Json -Depth 5
```

**Pass criteria:** Invalid payloads return 400 before any `ReturnRequest` write; valid submission creates return request.

---

## 3. Merchant Action API

**Route:** `PATCH /api/requests/{id}/action`

Requires merchant session cookie. Replace `$requestId` with a real return request ID from the dashboard.

| # | Test | Body | Expected |
|---|------|------|----------|
| 3.1 | Invalid action | `{ "action": "DELETE" }` | 400 |
| 3.2 | Missing action | `{ "merchantNote": "hi" }` | 400 |
| 3.3 | Too long merchant note | `merchantNote` > 1000 chars | 400 |
| 3.4 | Valid APPROVE | `{ "action": "APPROVE" }` | 200, `success: true` |
| 3.5 | Valid REJECT | `{ "action": "REJECT" }` | 200 |
| 3.6 | Valid NEEDS_MORE_INFO | `{ "action": "NEEDS_MORE_INFO", "merchantNote": "Need photos" }` | 200 |
| 3.7 | Valid RESOLVE | `{ "action": "RESOLVE" }` | 200 |

### PowerShell examples

```powershell
$requestId = "REPLACE_WITH_RETURN_REQUEST_ID"

# 3.1 Invalid action
Invoke-RestMethod -Method PATCH -Uri "$base/api/requests/$requestId/action" `
  -Headers $merchantHeaders `
  -Body '{"action":"DELETE"}' `
  -SkipHttpErrorCheck | ConvertTo-Json -Depth 5

# 3.2 Missing action
Invoke-RestMethod -Method PATCH -Uri "$base/api/requests/$requestId/action" `
  -Headers $merchantHeaders `
  -Body '{"merchantNote":"hi"}' `
  -SkipHttpErrorCheck | ConvertTo-Json -Depth 5

# 3.3 Too long note
$longNote = "n" * 1001
Invoke-RestMethod -Method PATCH -Uri "$base/api/requests/$requestId/action" `
  -Headers $merchantHeaders `
  -Body (@{ action = "APPROVE"; merchantNote = $longNote } | ConvertTo-Json) `
  -SkipHttpErrorCheck | ConvertTo-Json -Depth 5

# 3.4 APPROVE
Invoke-RestMethod -Method PATCH -Uri "$base/api/requests/$requestId/action" `
  -Headers $merchantHeaders `
  -Body '{"action":"APPROVE"}' | ConvertTo-Json -Depth 5

# 3.5 REJECT
Invoke-RestMethod -Method PATCH -Uri "$base/api/requests/$requestId/action" `
  -Headers $merchantHeaders `
  -Body '{"action":"REJECT"}' | ConvertTo-Json -Depth 5

# 3.6 NEEDS_MORE_INFO
Invoke-RestMethod -Method PATCH -Uri "$base/api/requests/$requestId/action" `
  -Headers $merchantHeaders `
  -Body '{"action":"NEEDS_MORE_INFO","merchantNote":"Please send photos"}' | ConvertTo-Json -Depth 5

# 3.7 RESOLVE
Invoke-RestMethod -Method PATCH -Uri "$base/api/requests/$requestId/action" `
  -Headers $merchantHeaders `
  -Body '{"action":"RESOLVE"}' | ConvertTo-Json -Depth 5
```

**Pass criteria:** Invalid actions rejected before DB update; valid actions update status, attempt email (`email.sent` in response), and write audit events.

---

## 4. Shopify Sync API

**Route:** `POST /api/shopify/orders/sync`

| # | Test | Expected |
|---|------|----------|
| 4.1 | Unauthenticated POST | 401, `{ "success": false, "error": "Unauthorized" }` |
| 4.2 | Body `merchantId` ignored | Authenticated POST with `{ "merchantId": "other-id" }` still syncs **session merchant only** |
| 4.3 | Protected customer data | If Shopify returns 403 protected-data error → 403, `code: "SHOPIFY_PROTECTED_CUSTOMER_DATA_REQUIRED"` |

### PowerShell examples

```powershell
# 4.1 Unauthenticated
Invoke-RestMethod -Method POST -Uri "$base/api/shopify/orders/sync" `
  -ContentType "application/json" `
  -SkipHttpErrorCheck | ConvertTo-Json -Depth 5

# 4.2 Body merchantId ignored (must use real session cookie)
Invoke-RestMethod -Method POST -Uri "$base/api/shopify/orders/sync" `
  -Headers $merchantHeaders `
  -Body '{"merchantId":"fake-other-merchant-id"}' | ConvertTo-Json -Depth 5

# 4.3 Protected customer data — verify in dashboard or response when Partner approval pending
Invoke-RestMethod -Method POST -Uri "$base/api/shopify/orders/sync" `
  -Headers $merchantHeaders | ConvertTo-Json -Depth 5
```

**Pass criteria:** No client-supplied `merchantId` can sync another store; body is ignored entirely.

---

## 5. Security checks

Run after any test above. Inspect **response body**, **browser Network tab**, and **terminal logs**.

| # | Check | Pass if |
|---|--------|---------|
| 5.1 | No stack traces | Response never contains `at ` stack lines or `node_modules` paths |
| 5.2 | No API keys | No `RESEND_API_KEY`, `SHOPIFY_API_SECRET`, or `sk_` values in JSON |
| 5.3 | No access token | No `shopifyAccessToken` or `X-Shopify-Access-Token` in response |
| 5.4 | No Prisma raw errors | No `PrismaClientKnownRequestError`, SQL, or `P2002` codes in JSON |
| 5.5 | Safe validation errors | 400 responses use `error: "Invalid request"` + `details` array only |
| 5.6 | Safe 500 errors | Generic messages only (`Unable to sync Shopify orders`, etc.); `debug` only in development |

### Quick grep on saved response (optional)

```powershell
$response = Invoke-WebRequest -Method POST -Uri "$base/api/check-return" `
  -ContentType "application/json" -Body '{"orderNumber":"1001"}' -SkipHttpErrorCheck
$response.Content | Select-String -Pattern "stack|Prisma|RESEND|accessToken|shopifyAccessToken"
# Should return no matches
```

---

## Sign-off

| Area | Tester | Date | Pass |
|------|--------|------|------|
| Check Return | | | ☐ |
| Submit Return | | | ☐ |
| Merchant Action | | | ☐ |
| Shopify Sync | | | ☐ |
| Security | | | ☐ |

**Notes**

- Email is sent on merchant actions when status/decision changes; email failure does not fail the action (`email.sent: false`).
- Re-submitting the same merchant action without status change may skip email (duplicate prevention).
- Seed orders for local testing: `1001` / `test1@gmail.com` (demo or Shopify merchant after seed).
