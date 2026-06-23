# Production Readiness Tracker — Return Recovery Copilot

Shopify Return Recovery SaaS · Last updated: 2026-06-16

---

## Current Focus

| | |
|---|---|
| **Current Focus** | Task 24 — Sync Scheduler |
| **Next Task** | Task 25 — Shopify Sync Queue |
| **Main Blocker** | ngrok/webhook production testing and protected customer data access |

---

## 1. Status Meaning

| Status | Meaning |
|--------|---------|
| **Not Started** | No meaningful implementation yet |
| **In Progress** | Work started; not stable or not fully tested locally |
| **Local Done** | Works in local dev with manual testing; not verified in production |
| **Needs Production Setup** | Code exists but requires prod env, URLs, Shopify approval, or infra |
| **Production Ready** | Deployed, configured, and verified in a production-like environment |
| **Blocked** | Cannot proceed without external dependency, approval, or decision |

**Rule of thumb:** Be conservative. `Local Done` ≠ `Production Ready`. Only mark **Production Ready** when production environment setup is clearly completed and verified.

---

## 2. Sprint 1A — Shopify Security Foundation

OAuth, sessions, webhook security, and Shopify compliance baseline.

| Task | Name | Status | Local Test | Production Need | Notes |
|------|------|--------|------------|-----------------|-------|
| 1 | Shopify OAuth Install Flow | Local Done | Yes | Production `SHOPIFY_APP_URL` on Vercel | `GET /api/auth/install` |
| 2 | OAuth Callback & Token Storage | Local Done | Yes | Secure prod DB + token encryption review | `GET /api/auth/callback` stores access token on `Merchant` |
| 3 | Merchant Session Cookie | Local Done | Yes | `MERCHANT_SESSION_SECRET` in prod | Signed cookie via `merchantSession.js` |
| 4 | Protected Route Middleware | Local Done | Yes | Confirm cookie domain/HTTPS in prod | `/dashboard`, `/analytics` guarded |
| 5 | Webhook HMAC Verification | Local Done | Yes | `SHOPIFY_API_SECRET` in prod | Shared `shopifyWebhook.js` |
| 6 | GDPR Compliance Webhooks | Local Done | Partial | Register compliance URLs in Partner Dashboard | `customers-data-request`, `customers-redact`, `shop-redact` |
| 7 | App Uninstall Webhook | Local Done | Partial | Production webhook URL registration | `app-uninstalled` deactivates merchant |
| 8 | Environment & Secrets Baseline | Local Done | Yes | All secrets in Vercel/hosting dashboard | See `docs/environment-setup.md`, `.env.example` |

---

## 3. Sprint 1B — Backend Infrastructure & Notifications

Database, validation, observability, audit, and email.

| Task | Name | Status | Local Test | Production Need | Notes |
|------|------|--------|------------|-----------------|-------|
| 9 | API Request Validation (Zod) | Local Done | Yes | None | Task 9 checklist in `docs/task-9-api-validation-test-checklist.md` |
| 10 | PostgreSQL + Prisma Schema | Local Done | Yes | Production DB + `migrate deploy` | Supabase/PostgreSQL; 8 migrations |
| 11 | Rate Limiting | Local Done | Yes | Tune limits for prod traffic | Task 11 checklist; in-memory limiter |
| 12 | Safe Error Handling | Local Done | Yes | Verify Sentry scrubs secrets in prod | `src/lib/errors.js`, `src/app/error.js` |
| 13 | Merchant API Auth Helpers | Local Done | Yes | None | `requireMerchant`, `requireMerchantForRoute` |
| 14 | ReturnEvent Audit Logging | Local Done | Yes | None | Customer + merchant action events |
| 15 | AdminAuditLog (System Events) | Local Done | Yes | None | Shopify sync, webhooks, unauthorized access |
| 16 | Customer Email Notifications | Needs Production Setup | Partial | `RESEND_API_KEY`, verified `EMAIL_FROM` domain | Works locally when Resend configured |
| 17 | Sentry Error Monitoring | Needs Production Setup | Partial | `SENTRY_DSN` + prod source maps | `@sentry/nextjs` wired; verify prod project |
| 18 | DB Seed & Dev Fixtures | Local Done | Yes | Production seed strategy (none for real merchants) | `npm run db:seed` |

---

## 4. Sprint 2 — Shopify Data Foundation

Order/product sync, webhooks, scheduling, and customer status.

| Task | Name | Status | Local Test | Production Need | Notes |
|------|------|--------|------------|-----------------|-------|
| 19 | Shopify Order Sync | Local Done | Yes | Needs PCD access or safe fallback | `POST /api/shopify/orders/sync`, REST Admin API |
| 20 | Shopify Product Sync | Local Done | Yes | Needs production API stability | `POST /api/shopify/products/sync`, GraphQL |
| 21 | Duplicate Return Prevention | Local Done | Yes | Confirm DB constraint/index | Per `OrderItem` duplicate block |
| 22 | Order Status Updates | Local Done | Yes | Confirm committed to git | `financialStatus`, `fulfillmentStatus`, `cancelledAt` |
| 23 | Webhook-driven Updates | In Progress | Localhost works, ngrok issue | Needs production webhook URL | orders/create, orders/updated, fulfillments/create, products/update |
| 24 | Sync Scheduler | In Progress | Needs local cron endpoint test | Needs `CRON_SECRET` and Vercel cron | No `vercel.json` cron yet |
| 25 | Shopify Sync Queue | Not Started | No | Needs Inngest production setup | No Inngest dependency in repo |
| 26 | Customer Status Tracking Page | Not Started | No | Needs public-safe customer status page | Basic `/status` exists locally; treat as scaffold only |

---

## 5. Sprint 3 — Merchant Rules & Recovery

Customer return flow, eligibility, scoring, and merchant policy fields.

| Task | Name | Status | Local Test | Production Need | Notes |
|------|------|--------|------------|-----------------|-------|
| 27 | Customer Return Portal (`/`) | Local Done | Yes | Merchant branding per shop | Multi-step return form |
| 28 | Check Return / Eligibility API | Local Done | Yes | Order source must be synced orders in prod | `POST /api/check-return` |
| 29 | Submit Return API | Local Done | Yes | Proof image storage strategy for prod | `POST /api/submit-return` |
| 30 | Merchant Recovery Rules (Schema) | Local Done | Yes | Admin UI to edit rules not built | `returnWindowDays`, `allowExchange`, etc. on `Merchant` |
| 31 | Mock AI Scoring & Recommendations | Local Done | Yes | Replace with real AI in Sprint 6 | `returnScoring.js` — rule-based, not LLM |
| 32 | Proof Image Handling | Local Done | Partial | Move off base64-in-DB for scale | `proofImageUrl.js` |
| 33 | Return Window & Eligibility Logic | Local Done | Yes | Depends on accurate order dates from sync | `orderLookup.js`, eligibility fields |
| 34 | Customer Status API | Local Done | Yes | Rate limit + abuse protection in prod | `POST /api/return-status` |

---

## 6. Sprint 4 — Merchant Experience & QA

Dashboard, merchant actions, and operational UX.

| Task | Name | Status | Local Test | Production Need | Notes |
|------|------|--------|------------|-----------------|-------|
| 35 | Merchant Dashboard | Local Done | Yes | Remove debug logs before prod | `/dashboard` — loading bug fixed |
| 36 | Dashboard Filtering & Sorting | Local Done | Yes | None | Status filters + sort options |
| 37 | Merchant Request Actions | Local Done | Yes | Email delivery in prod | Approve / reject / resolve / needs info |
| 38 | Order Status Badges | Local Done | Yes | None | `OrderStatusBadges.jsx` on request cards |
| 39 | RequestCard & Recovery UI | Local Done | Yes | None | Risk bars, item details, notes |
| 40 | Manual Shopify Sync Buttons | Local Done | Yes | PCD + rate limits in prod | Dashboard sync orders/products |
| 41 | Merchant QA Test Pass | In Progress | Partial | Full E2E on staging shop | No formal sign-off doc yet |
| 42 | Remove Temporary Debug Logs | In Progress | N/A | Clean console before pilot | `[DASHBOARD DEBUG]` logs in `dashboard/page.js` |

---

## 7. Sprint 5 — Analytics Foundation

Merchant-facing recovery metrics.

| Task | Name | Status | Local Test | Production Need | Notes |
|------|------|--------|------------|-----------------|-------|
| 43 | Analytics Page (`/analytics`) | Local Done | Yes | None | Reads `/api/requests` |
| 44 | Recovery Rate & Status Metrics | Local Done | Yes | None | Approved/resolved/pending counts |
| 45 | Reason & Option Breakdowns | Local Done | Yes | None | Top reason, top option, risk |
| 46 | Analytics Auth Protection | Local Done | Yes | None | Layout + middleware |
| 47 | Historical / Time-series Analytics | Not Started | No | Needs event aggregation or warehouse | Current page is snapshot only |
| 48 | Merchant Export (CSV) | Not Started | No | None | Not implemented |

---

## 8. Sprint 6 — AI Offer Ladder

Real AI classification and configurable recovery ladder.

| Task | Name | Status | Local Test | Production Need | Notes |
|------|------|--------|------------|-----------------|-------|
| 49 | Real AI Classification | Not Started | No | LLM API key + prompt governance | `aiSummary` populated by rules today |
| 50 | Offer Ladder Engine | Not Started | No | Merchant-configurable tiers | Schema has recovery options; no ladder UI |
| 51 | Merchant Ladder Configuration UI | Not Started | No | None | Rules in DB only, no settings page |
| 52 | AI Summary for Merchant Dashboard | Not Started | No | Depends on Task 49 | Field exists on `ReturnItem` |
| 53 | AI Audit Events | Local Done | Yes | None | `AI_SCORED` event on submit (mock) |

---

## 9. Sprint 7 — Reliability & Scale

Production infra, jobs, monitoring, and resilience.

| Task | Name | Status | Local Test | Production Need | Notes |
|------|------|--------|------------|-----------------|-------|
| 54 | Production Deployment (Vercel) | Needs Production Setup | No | Vercel project + env vars | `npm run build` passes locally |
| 55 | Production Database (Supabase) | Needs Production Setup | Partial | `DATABASE_URL`, `DIRECT_URL`, migrations | Local Supabase in use |
| 56 | Webhook URL Registration (Prod) | Needs Production Setup | No | Stable `APP_URL` on Vercel | Blocked by ngrok/tunnel testing |
| 57 | Protected Customer Data (PCD) | Blocked | No | Shopify Partner approval for `read_orders` | Sync shows PCD error code when missing |
| 58 | Cron / Scheduled Sync | In Progress | No | `vercel.json` + `CRON_SECRET` | Task 24 dependency |
| 59 | Background Job Queue (Inngest) | Not Started | No | Inngest prod app + signing key | Task 25 dependency |
| 60 | Uptime & Alerting | Not Started | No | Sentry alerts + uptime monitor | Sentry partially wired |
| 61 | Load / Rate Limit Tuning | Not Started | No | Production traffic profile | In-memory limiter may need Redis at scale |

---

## 10. Sprint 8 — Launch

Pilot, App Store, billing, and go-live.

| Task | Name | Status | Local Test | Production Need | Notes |
|------|------|--------|------------|-----------------|-------|
| 62 | Pilot Merchant Onboarding Runbook | Not Started | No | Staging shop + support process | |
| 63 | Shopify App Store Listing | Not Started | No | Screenshots, privacy policy, support URL | |
| 64 | Billing Integration (Shopify Billing) | Not Started | No | `PlanTier` in schema unused | FREE/STARTER/GROWTH/SCALE enums exist |
| 65 | Privacy Policy & Terms | Not Started | No | Legal review | Required for App Review |
| 66 | Production Launch Checklist Sign-off | Not Started | No | All prior sprints green | |
| 67 | Post-launch Support Playbook | Not Started | No | Runbooks for sync/webhook failures | |

---

## 11. Before Pilot Merchant Checklist

Use before onboarding the first real merchant (non-dev store).

- [ ] Production deployed on Vercel with all env vars from `docs/environment-setup.md`
- [ ] `npx prisma migrate deploy` run against production DB
- [ ] Shopify app configured with production URL (not localhost/ngrok)
- [ ] OAuth install + callback tested on production URL
- [ ] Webhooks registered and verified (HMAC + real order event)
- [ ] Order sync works OR graceful PCD fallback messaging is acceptable
- [ ] Customer return submission E2E on pilot shop
- [ ] Merchant dashboard loads requests (no stuck loading)
- [ ] Merchant approve/reject sends email (Resend domain verified)
- [ ] `[DASHBOARD DEBUG]` and other temp logs removed
- [ ] Sentry receiving errors from production
- [ ] Rate limits reviewed for public endpoints
- [ ] Pilot merchant support contact documented

---

## 12. Before Shopify App Review Checklist

Use before submitting to the Shopify App Store.

- [ ] Production app URL stable (no tunnel)
- [ ] GDPR mandatory webhooks implemented and registered
- [ ] App uninstall webhook tested
- [ ] Privacy policy URL live
- [ ] Data handling documented (customer PII, retention, redaction)
- [ ] Protected Customer Data access requested/approved if reading orders
- [ ] OAuth scopes minimal and justified (`SHOPIFY_SCOPES`)
- [ ] No dev-only routes exposed (`/api/dev/*`, `/api/admin/test`)
- [ ] Error pages do not leak stack traces or secrets
- [ ] App listing screenshots match actual UI
- [ ] Billing flow implemented (if charging merchants)
- [ ] Session handling secure (HTTPS-only cookies in prod)

---

## 13. Before Paid Launch Checklist

Use before charging merchants or scaling beyond pilot.

- [ ] Shopify Billing API integrated and tested
- [ ] Plan tiers enforced (`PlanTier` on `Merchant`)
- [ ] Sync scheduler + queue reliable in production (Tasks 24–25)
- [ ] Webhook-driven updates verified without manual sync (Task 23)
- [ ] Customer status page production-ready (Task 26)
- [ ] Analytics accurate against production data
- [ ] AI offer ladder live or explicitly deferred with merchant messaging (Sprint 6)
- [ ] Load testing on submit-return and dashboard APIs
- [ ] Backup / restore tested for PostgreSQL
- [ ] Incident runbook: sync failure, webhook outage, email failure
- [ ] Monitoring alerts configured (Sentry + uptime)
- [ ] Legal: terms of service, refund policy, DPA if required

---

## Quick Reference — Task Number Index

| Range | Sprint |
|-------|--------|
| 1–8 | 1A — Shopify Security Foundation |
| 9–18 | 1B — Backend Infrastructure & Notifications |
| 19–26 | 2 — Shopify Data Foundation |
| 27–34 | 3 — Merchant Rules & Recovery |
| 35–42 | 4 — Merchant Experience & QA |
| 43–48 | 5 — Analytics Foundation |
| 49–53 | 6 — AI Offer Ladder |
| 54–61 | 7 — Reliability & Scale |
| 62–67 | 8 — Launch |

---

## Related Docs

- [Environment setup](./environment-setup.md)
- [Task 23 — Webhook testing](./task-23-webhook-testing.md)
- [Task 9 — API validation](./task-9-api-validation-test-checklist.md)
- [Task 11 — Rate limiting](./task-11-rate-limiting-test-checklist.md)
- [Task 12 — Error handling](./task-12-error-handling-test-checklist.md)
- [Task 14 — Audit logging](./task-14-audit-logging-test-checklist.md)
- [Task 15 — Admin audit logging](./task-15-admin-audit-logging-test-checklist.md)
