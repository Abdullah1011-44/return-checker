This is a [Next.js](https://nextjs.org) project bootstrapped with [`create-next-app`](https://github.com/vercel/next.js/tree/canary/packages/create-next-app).

## Database setup (Prisma + PostgreSQL)

1. Copy `.env.example` to `.env` and set `DATABASE_URL` (and `DIRECT_URL` if you use Supabase pooling).

2. Apply migrations (first time only):

```bash
npm run prisma:migrate:dev
```

3. Seed test data (one demo merchant + mock orders `1001`–`1003`):

```bash
npm run db:seed
```

This inserts the same order numbers, customer emails, SKUs, and prices used by `/api/check-return`, so `/api/submit-return` can find orders in PostgreSQL.

**Test accounts after seeding:**

| Order # | Email |
|---------|--------|
| 1001 | test1@gmail.com |
| 1002 | test2@gmail.com |
| 1003 | test3@gmail.com |

Re-run `npm run db:seed` anytime to reset demo data (it deletes and recreates the demo merchant).

## Getting Started

First, run the development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

You can start editing the page by modifying `app/page.js`. The page auto-updates as you edit the file.

This project uses [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) to automatically optimize and load [Geist](https://vercel.com/font), a new font family for Vercel.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.
