# Task 23 — Shopify Webhook Testing Guide

Internal developer notes for webhook registration, manual verification, audit events, security checks, and troubleshooting.

**Related code**

| Area | Path |
|------|------|
| Webhook registration | `src/lib/shopifyWebhooks.js` |
| OAuth callback (registers webhooks) | `src/app/api/auth/callback/route.js` |
| Shared handlers | `src/lib/shopifyWebhookHandlers.js` |
| HMAC verification | `src/lib/shopifyWebhook.js` |
| Automated tests | `tests/webhookRoutes.test.js` |

**Webhook endpoints**

| Shopify topic | App route |
|---------------|-----------|
| `orders/create` | `POST /api/webhooks/orders-create` |
| `orders/updated` | `POST /api/webhooks/orders-updated` |
| `fulfillments/create` | `POST /api/webhooks/fulfillments-create` |
| `products/update` | `POST /api/webhooks/products-update` |

---

## Prerequisites

1. Dev server: `npm run dev`
2. Database migrated and merchant connected via Shopify OAuth
3. **Public HTTPS URL** for Shopify to reach your app (ngrok, Cloudflare Tunnel, or deployed staging)
4. Environment variables set in `.env.local`:

```env
SHOPIFY_API_KEY=...
SHOPIFY_API_SECRET=...
SHOPIFY_APP_URL=https://your-tunnel.example   # OAuth redirects
APP_URL=https://your-tunnel.example           # Required for webhook registration
NODE_ENV=development                          # Allows localhost APP_URL only in dev
```

**Important:** Webhook registration reads **`APP_URL`** (not `SHOPIFY_APP_URL`). Both should point to the same public base URL during webhook testing.

Run automated webhook tests anytime:

```powershell
npx vitest run tests/webhookRoutes.test.js
```

---

## 1. Reinstall app to trigger webhook registration

Webhooks are registered automatically after a successful OAuth install in:

`src/app/api/auth/callback/route.js` → `registerShopifyWebhooks()`

Registration is **non-blocking** — install/login still succeeds if registration fails.

### Steps

1. Set `APP_URL` to your current public HTTPS base URL (no trailing slash).
2. Restart the dev server so env vars reload.
3. Reinstall the app for your dev store:

```
https://<APP_URL>/api/auth/install?shop=<your-store>.myshopify.com
```

4. Complete Shopify OAuth approval.
5. You should land on `/dashboard` even if some webhooks failed to register.

### Confirm registration in server logs

Look for:

```
[Shopify Webhook Registration] { shopDomain, topic, endpointPath, status }
```

Statuses: `registered`, `skipped` (already exists), or `failed`.

### Confirm audit log

In **AdminAuditLog** (Prisma Studio) or `[Audit]` console output:

| Field | Expected |
|-------|----------|
| `eventType` | `WEBHOOKS_REGISTERED` |
| `metadata.shopDomain` | Your store domain |
| `metadata.registeredCount` | Number newly created |
| `metadata.skippedCount` | Number already present |
| `metadata.failedCount` | `0` on full success |

Webhook registration failure does **not** block OAuth. Check `failedCount` and server logs if counts look wrong.

---

## 2. Confirm webhooks in Shopify Admin

1. Open **Shopify Admin** → **Settings** → **Notifications** → **Webhooks**  
   (or **Apps** → your app → **App webhooks**, depending on Shopify UI version)
2. Verify these four subscriptions exist and point to your `APP_URL`:

| Topic | Address |
|-------|---------|
| Order creation | `{APP_URL}/api/webhooks/orders-create` |
| Order update | `{APP_URL}/api/webhooks/orders-updated` |
| Fulfillment creation | `{APP_URL}/api/webhooks/fulfillments-create` |
| Product update | `{APP_URL}/api/webhooks/products-update` |

3. Format should be **JSON**.
4. Re-running OAuth install should **skip** duplicates (idempotent registration).

---

## 3. Manual webhook flow tests

Use a Shopify **development store** connected to your app. Keep the dev server terminal open to watch `[Audit]` and `[Shopify Webhook]` logs.

Optional DB inspection:

```powershell
npx prisma studio
```

Tables to watch:

- `CustomerOrder` — order webhooks
- `ShopifyProduct` — product webhooks (run **Sync Products** first so a local row exists)
- `AdminAuditLog` — webhook audit events

### A. Create order (`orders/create`)

1. In Shopify Admin, create a **test order** (or use Bogus Gateway / test checkout).
2. Wait a few seconds for Shopify to deliver the webhook.

**Expected**

- `CustomerOrder` row created with:
  - `shopifyOrderId` = Shopify order ID
  - `financialStatus`, `fulfillmentStatus`, `status` mapped
  - Placeholder email: `shopify-order-{id}@placeholder.returnradar.local` (no real customer email stored)
- `[Audit] ORDER_CREATED_WEBHOOK` with `shopifyOrderId`, `orderNumber`, `source: shopify_webhook`
- `AdminAuditLog.eventType = ORDER_CREATED_WEBHOOK`
- Sending the same webhook again → **no duplicate row** (upsert by `merchantId` + `shopifyOrderId`)

### B. Update order (`orders/updated`)

1. Change order state in Shopify (e.g. mark paid, cancel, edit totals).
2. Wait for webhook delivery.

**Expected**

- Existing `CustomerOrder` updated: `status`, `financialStatus`, `fulfillmentStatus`, `cancelledAt`, `totalAmount`, `currency`
- `ReturnRequest` / `ReturnItem` rows **unchanged**
- `[Audit] ORDER_UPDATED_WEBHOOK`
- If no local order exists → HTTP **200** `{ success: true, ignored: true }` + `ORDER_UPDATED_WEBHOOK_IGNORED`

### C. Fulfill order (`fulfillments/create`)

1. Create a fulfillment for the order in Shopify Admin.
2. Optionally mark shipment as **delivered** (depending on carrier/test flow).

**Expected**

| Shopify `shipment_status` | Local `status` | Local `fulfillmentStatus` |
|---------------------------|----------------|---------------------------|
| `delivered` | `DELIVERED` | `fulfilled` |
| `in_transit` (or other non-delivered) | `FULFILLED` | `fulfilled` |

- `[Audit] FULFILLMENT_CREATED_WEBHOOK`
- No tracking numbers or shipping addresses stored
- Missing local order → **200** `{ success: true, ignored: true }`

### D. Edit product (`products/update`)

1. Run **Sync Products** from the merchant dashboard first (creates local `ShopifyProduct` rows).
2. Edit product title, vendor, or status in Shopify Admin.

**Expected**

- Existing `ShopifyProduct` updated: `title`, `handle`, `vendor`, `productType`, `status`, `updatedAt`
- Variants **not** created/updated from webhook payload
- `[Audit] PRODUCT_UPDATED_WEBHOOK`
- Product not synced locally → **200** `{ success: true, ignored: true }` (no incomplete create)

---

## 4. Expected audit log events

| Event | When |
|-------|------|
| `WEBHOOKS_REGISTERED` | After OAuth install webhook registration |
| `ORDER_CREATED_WEBHOOK` | New local order created from `orders/create` |
| `ORDER_UPDATED_WEBHOOK` | Existing order updated from `orders/updated` |
| `ORDER_UPDATED_WEBHOOK_IGNORED` | `orders/updated` received but no local order found |
| `FULFILLMENT_CREATED_WEBHOOK` | Fulfillment processed for known order |
| `PRODUCT_UPDATED_WEBHOOK` | Known local product updated from `products/update` |

All webhook audit metadata should be **safe summaries only** — no raw payload, tokens, or customer PII.

Console format:

```
[Audit] ORDER_CREATED_WEBHOOK { shopDomain, shopifyOrderId, orderNumber, source }
```

---

## 5. Security checklist

Verify during manual and automated testing:

| Check | Expected behavior |
|-------|-------------------|
| Invalid HMAC | HTTP **401** `{ error: "Unauthorized" }` |
| Missing `x-shopify-hmac-sha256` | HTTP **401** |
| Unknown / inactive merchant | HTTP **200** `{ success: true, ignored: true }` |
| Invalid JSON (valid HMAC) | HTTP **400** |
| Raw body handling | `request.text()` before `JSON.parse()` — HMAC verified on raw string |
| Shop domain trust | Use `x-shopify-shop-domain` header only — **never** payload shop fields for auth |
| No raw webhook body logs | Server logs must not print full POST body |
| No access token logs | No `shpat_`, `shopifyAccessToken`, or `accessToken` in logs/audit |
| No customer PII stored | No payload email, phone, address, or customer name persisted |
| Merchant isolation | All DB lookups/writes include `merchantId` scope |

Automated coverage: `tests/webhookRoutes.test.js` (27 tests).

---

## 6. Troubleshooting

### Webhook not firing

- Confirm `APP_URL` matches the URL Shopify can reach (use ngrok/HTTPS tunnel, not plain `localhost` in production).
- Confirm webhooks exist in Shopify Admin (see section 2).
- Reinstall app after changing `APP_URL`.
- Check Shopify Admin webhook delivery logs for failed attempts.
- Ensure dev server is running and tunnel points to the correct port.

### HMAC failing (401 Unauthorized)

- Verify `SHOPIFY_API_SECRET` matches Partner Dashboard app secret.
- Ensure route reads **raw body** with `readRawBody()` before `JSON.parse()`.
- Do not parse JSON in middleware before the route handler runs.
- If testing manually with `curl`, compute HMAC on the **exact** raw body bytes sent.

### Duplicate orders

- Uniqueness: `@@unique([merchantId, shopifyOrderId])` on `CustomerOrder`.
- `orders/create` upserts: second delivery updates status fields instead of creating a duplicate.
- Check for multiple merchants or mismatched `shopifyOrderId` formats (string vs number).

### 404 from webhook URL

- Confirm route files exist:
  - `src/app/api/webhooks/orders-create/route.js`
  - `src/app/api/webhooks/orders-updated/route.js`
  - `src/app/api/webhooks/fulfillments-create/route.js`
  - `src/app/api/webhooks/products-update/route.js`
- Restart dev server after adding routes.
- If port changed (e.g. 3001), update tunnel and `APP_URL`.
- Run `npm run build` to confirm routes are registered.

### Shopify keeps retrying webhooks

- Return **200** for successfully processed or safely ignored events.
- Return **401** only for invalid HMAC (Shopify should not retry with same bad signature).
- Return **400** for malformed JSON.
- Avoid **500** for expected business cases (unknown merchant, missing local order) — those return 200 + `ignored: true`.
- Fix server errors causing 500 responses; Shopify will retry failed deliveries.

### WEBHOOKS_REGISTERED shows failures

- `APP_URL` missing → set in `.env.local` and restart.
- `APP_URL` is localhost in production → blocked unless `NODE_ENV=development`.
- Missing OAuth scopes → reinstall after updating `SHOPIFY_SCOPES`.
- Check `[Shopify Webhook Registration] status: failed` lines for per-topic errors.

---

## Quick reference commands

```powershell
# Start app
npm run dev

# Run webhook test suite
npx vitest run tests/webhookRoutes.test.js

# Inspect DB
npx prisma studio

# Reinstall (replace store domain)
# Open in browser:
# https://<APP_URL>/api/auth/install?shop=<store>.myshopify.com
```
