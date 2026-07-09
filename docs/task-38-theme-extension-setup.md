# Task 38 — Return Assistant Theme Extension Setup

Merchant and developer guide for the storefront Return Assistant theme extension, app proxy, and manual verification.

**Related code**

| Area | Path |
|------|------|
| App proxy route | `src/app/api/proxy/return-assistant/route.js` |
| Proxy verification | `src/lib/shopifyAppProxy.js` |
| Storefront bootstrap | `src/lib/returnAssistantStorefront.js` |
| Theme extension | `extensions/return-assistant/` |
| Proxy route tests | `tests/returnAssistantProxyRoute.test.js` |
| Dashboard CTA | `src/app/dashboard/page.js` |

**Storefront mapping**

| Storefront URL | App backend |
|----------------|-------------|
| `/apps/return-assistant` | `/api/proxy/return-assistant` |

---

## Prerequisites

1. Shopify app installed for the merchant (active, not uninstalled).
2. Public app URL configured (`SHOPIFY_APP_URL` in `.env`).
3. Shopify CLI installed for extension deploy (optional for local theme preview).

```env
SHOPIFY_APP_URL=https://your-app.example
SHOPIFY_API_SECRET=...
```

---

## 1. Partner Dashboard — App proxy

Configure the app proxy in **Shopify Partner Dashboard → Apps → Your app → Configuration → App proxy**:

| Field | Value |
|-------|-------|
| **Subpath prefix** | `apps` |
| **Subpath** | `return-assistant` |
| **Proxy URL** | `https://YOUR_APP_URL/api/proxy/return-assistant` |

Replace `YOUR_APP_URL` with your deployed base URL (same value as `SHOPIFY_APP_URL`, no trailing slash).

Example:

```text
https://return-checker.example/api/proxy/return-assistant
```

After saving, storefront requests to:

```text
https://{shop}.myshopify.com/apps/return-assistant
```

are signed by Shopify and forwarded to your app proxy route.

---

## 2. Deploy the theme extension

From the app project root (with Shopify CLI authenticated):

```powershell
shopify app deploy
```

This publishes `extensions/return-assistant/` including:

- `blocks/return-assistant.liquid` — inline section block
- `blocks/return-assistant-embed.liquid` — floating app embed
- `assets/return-assistant.css`
- `assets/return-assistant.js`

**Note:** `shopify.app.toml` is not required in-repo for this task; proxy and extension can be configured via Partner Dashboard and CLI deploy.

For local theme development against a dev store:

```powershell
shopify app dev
```

---

## 3. Theme editor — Enable for merchants

Merchants can also use the dashboard CTA (**Open Theme Editor**) on `/dashboard`, which links to:

```text
https://admin.shopify.com/store/{store-handle}/themes
```

### Option A — Floating launcher (app embed)

1. **Online Store → Themes → Customize**
2. Open **Theme settings** (gear icon) → **App embeds**
3. Enable **Return Assistant (floating)**
4. Configure position, copy, accent color, and proxy path (default `/apps/return-assistant`)
5. **Save**

### Option B — Inline block (section)

1. **Online Store → Themes → Customize**
2. Open a page template (e.g. homepage or a returns page section)
3. **Add block** → **Apps** → **Return Assistant**
4. Place the block in a supported section and adjust settings
5. **Save**

---

## 4. Manual test checklist

Run these checks on a dev store after proxy + extension deploy.

### Storefront UI

- [ ] **Floating launcher appears** when the floating app embed is enabled (bottom-left or bottom-right).
- [ ] **Inline block appears** when the Return Assistant app block is added to a section.
- [ ] Clicking the floating launcher opens the placeholder panel (no full chat UI yet).
- [ ] Inline card remains visible with title, greeting, and button (placeholder mode).

### App proxy (signed storefront path)

From the storefront (or browser while logged into the shop), open:

```text
https://{shop}.myshopify.com/apps/return-assistant
```

- [ ] Returns **200** JSON with `ok: true`, `enabled: true`, and public bootstrap fields.
- [ ] Response does **not** include `shopifyAccessToken` or other secrets.

### Backend trust boundary (unsigned)

Call the app URL directly without Shopify signature params:

```powershell
curl -i "https://YOUR_APP_URL/api/proxy/return-assistant"
```

- [ ] Returns **401** JSON (`APP_PROXY_SIGNATURE_MISSING` or similar safe error code).
- [ ] Does not leak env secrets (`SHOPIFY_API_SECRET`, `DATABASE_URL`, etc.).

### Automated tests

```powershell
npx vitest run tests/returnAssistantProxyRoute.test.js
npx vitest run src/lib/__tests__/shopifyAppProxy.test.js
```

---

## 5. Future work (not in Task 38)

The current extension is a **bootstrap + placeholder** only. These features are planned for later tasks:

- Full chatbot UI
- Customer order verification on the storefront
- Product selection in the assistant flow
- Image upload from the storefront widget
- Dynamic follow-up questions and AI offer presentation

Until then, `features` in the bootstrap JSON remain `false`, and customers should continue using existing return flows (`check-return` / `submit-return`) where applicable.

---

## Troubleshooting

| Symptom | Likely cause |
|---------|----------------|
| `/apps/return-assistant` 404 on storefront | App proxy not configured or wrong subpath |
| Proxy returns 401 on storefront | Merchant inactive/uninstalled, or clock skew on timestamp |
| Extension blocks missing in theme editor | Extension not deployed (`shopify app deploy`) |
| Launcher does not appear | App embed not enabled in theme editor |
| Direct backend URL returns 200 without signature | Misconfiguration — proxy route must always verify signature first |

For proxy verification details, see `src/lib/shopifyAppProxy.js` and `tests/returnAssistantProxyRoute.test.js`.
