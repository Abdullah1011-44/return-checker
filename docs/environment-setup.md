# Environment Setup — Return Recovery Copilot

This guide explains how to configure environment variables for local development and production.

## Purpose

- **`.env`** — Your real secrets and environment-specific values. **Never commit this file.**
- **`.env.example`** — Safe placeholders only. Commit this so teammates know which variables are required.

Copy the example file to get started:

```bash
cp .env.example .env
```

Then fill in real values locally. For production, set the same variables in your hosting provider’s dashboard (Vercel, Railway, etc.).

---

## Required variables (local development)

| Variable | Required | Notes |
|----------|----------|--------|
| `DATABASE_URL` | Yes | PostgreSQL connection string for Prisma |
| `DIRECT_URL` | Yes* | Direct DB URL (often same as `DATABASE_URL`; required by Prisma with poolers like Supabase) |
| `SHOPIFY_APP_URL` | Yes | Public app URL for OAuth redirects (`http://localhost:3000` locally) |
| `SHOPIFY_API_KEY` | Yes | Shopify app API key from Partner Dashboard |
| `SHOPIFY_API_SECRET` | Yes | Shopify app API secret (also used for webhook HMAC) |
| `SHOPIFY_SCOPES` | Yes | OAuth scopes; must include `read_orders` for order sync |
| `SHOPIFY_ADMIN_API_VERSION` | No | Defaults to `2026-04` in code |
| `RESEND_API_KEY` | Yes* | Required for customer email notifications |
| `EMAIL_FROM` | Yes* | Sender address for Resend |
| `MERCHANT_SESSION_SECRET` | No | Signs merchant session cookies; falls back to `SHOPIFY_API_SECRET` in dev |

\*Required when using that feature (database, email).

**App URL alias:** The code accepts `APP_URL` as a fallback if `SHOPIFY_APP_URL` is not set. Prefer `SHOPIFY_APP_URL` to match `.env.example`.

---

## Variable reference

### Database

**`DATABASE_URL`**  
PostgreSQL connection string used by Prisma at runtime. Example:

```env
DATABASE_URL="postgresql://USER:PASSWORD@HOST:5432/DATABASE"
```

**`DIRECT_URL`**  
Direct connection for migrations and Prisma when using a connection pooler. Often the same host as `DATABASE_URL` without pooling, or a “direct” host from your provider.

### Shopify

**`SHOPIFY_APP_URL`**  
The public URL where this app is hosted. Used for OAuth install/callback redirects and post-install redirects to the dashboard.

- Local: `http://localhost:3000`
- Production: `https://your-production-domain.com`

Must match the app URL configured in the Shopify Partner Dashboard.

**`SHOPIFY_API_KEY`**  
Client ID / API key from **Shopify Partner Dashboard → Apps → Your app → Client credentials**.

**`SHOPIFY_API_SECRET`**  
API secret key from the same screen. Used for OAuth, webhook HMAC verification, and (in dev) merchant session signing if `MERCHANT_SESSION_SECRET` is unset.

**Never log or return this value in API responses.**

**`SHOPIFY_SCOPES`**  
Comma-separated OAuth scopes. Minimum for order sync:

```env
SHOPIFY_SCOPES="read_orders"
```

If you add scopes later, merchants must **reinstall** the app — existing tokens do not gain new permissions automatically.

**`SHOPIFY_ADMIN_API_VERSION`**  
Shopify Admin REST API version (e.g. `2026-04`). Optional; defaults in `src/lib/shopifyAdmin.js`.

### Email (Resend)

**`RESEND_API_KEY`**  
API key from [Resend](https://resend.com). Used when merchants approve/reject returns and customer notifications are sent.

**`EMAIL_FROM`**  
From address Resend sends as. Local/testing example:

```env
EMAIL_FROM="Returns Team <onboarding@resend.dev>"
```

Production should use a **verified domain** in Resend (see Production notes below).

### Session (optional)

**`MERCHANT_SESSION_SECRET`**  
Secret for signing the httpOnly merchant session cookie after Shopify OAuth. If unset in development, the app may fall back to `SHOPIFY_API_SECRET`. Set a dedicated secret in production.

---

## Security rules

1. **Never commit `.env`** — It is listed in `.gitignore`. Only commit `.env.example` with placeholders.
2. **Never paste API keys** into chat tools, screenshots, or public issue trackers.
3. **Never log Shopify access tokens** — They are stored server-side in the database only.
4. **Never log `RESEND_API_KEY` or `SHOPIFY_API_SECRET`** — Debug logs should use booleans like `hasApiKey: true/false`.
5. **Rotate keys immediately** if a secret is exposed (Shopify, Resend, database password, session secret).
6. **Use a verified sending domain** in production for `EMAIL_FROM` (Resend domain verification).
7. **Do not expose env values** in API JSON responses or client-side bundles.

---

## Local development example

Use placeholders only in `.env.example`. Your local `.env` might look like:

```env
DATABASE_URL="postgresql://postgres:postgres@localhost:5432/return_checker"
DIRECT_URL="postgresql://postgres:postgres@localhost:5432/return_checker"

SHOPIFY_APP_URL="http://localhost:3000"
SHOPIFY_API_KEY="your_shopify_api_key"
SHOPIFY_API_SECRET="your_shopify_api_secret"
SHOPIFY_SCOPES="read_orders"
SHOPIFY_ADMIN_API_VERSION="2026-04"

RESEND_API_KEY="your_resend_api_key"
EMAIL_FROM="Returns Team <onboarding@resend.dev>"

MERCHANT_SESSION_SECRET="local-dev-session-secret-change-me"
```

After editing `.env`:

```bash
npm run dev
```

Shopify install URL (replace shop name):

```
http://localhost:3000/api/auth/install?shop=your-store.myshopify.com
```

---

## Production notes

1. **Set all env vars in the hosting dashboard** — Do not upload `.env` to git. Configure each variable in Vercel / Railway / etc.
2. **Use a production `DATABASE_URL`** — Managed PostgreSQL with SSL; set `DIRECT_URL` if your provider requires it for migrations.
3. **Use your real public `SHOPIFY_APP_URL`** — Must be HTTPS and match Partner Dashboard redirect URLs (`/api/auth/callback`).
4. **Verify your domain in Resend** — Update `EMAIL_FROM` to something like `Returns <returns@yourdomain.com>`.
5. **Protected customer data (Shopify)** — If order sync returns `SHOPIFY_PROTECTED_CUSTOMER_DATA_REQUIRED`, request Protected customer data access in Partner Dashboard and reinstall the app.
6. **Scope changes** — After changing `SHOPIFY_SCOPES`, merchants must reinstall so new tokens include the updated scopes.
7. **Run migrations** — `npx prisma migrate deploy` (production) after schema updates.

---

## Related docs

- [Task 9 API validation checklist](./task-9-api-validation-test-checklist.md)
- Env helpers: `src/lib/env.js`
- Shopify config: `src/lib/shopify.js`
