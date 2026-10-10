A crypto trading and investment website that allow users to invest in various financial sectors e.g bonds, forex, crypto, big tech e.t.c. and get a high margin ROI. 
In addition, it gives users the premium access to up-to-date market data and analysis report using analytic charts and tables.

## Deploying on Vercel

The database is Neon over the Prisma driver adapter, so the deployment needs all four
variables from `.env.example` set for **Production** (and Preview) in
**Vercel → Project → Settings → Environment Variables**:

| Variable | Purpose |
| --- | --- |
| `DATABASE_URL` | Pooled Neon connection string (`postgresql://...?sslmode=require`) |
| `DIRECT_URL` | Direct (non-pooled) Neon connection string, used by `prisma migrate deploy` |
| `JWT_SECRET` | Signs customer session cookies |
| `ADMIN_JWT_SECRET` | Signs admin session cookies |

Notes:

- Paste the bare connection string, without the surrounding quotes used in `.env`
  files. Quotes, stray whitespace and a copied `DATABASE_URL=...` line are normalized,
  but a value that is still wrong is reported as `DATABASE_CONFIG_ERROR`.
- Changing environment variables only affects **new** deployments, so redeploy after
  editing them.
- The build command (`vercel.json` → `npm run db:deploy && npm run build`) applies
  pending Prisma migrations before building, so it fails immediately with the name of
  the variable that is missing instead of shipping a database-less deployment.
- Node.js 22 is pinned through `engines` in `package.json`. The Neon adapter talks to
  the database over a WebSocket; Node.js 22 provides one natively and the app falls
  back to the bundled `ws` package on older runtimes.
- `GET /api/health` reports `ok`, the configuration problem (`reason`), the environment
  variable the connection string came from (`source`) and a short `hint`. It never
  exposes the connection string, so it is safe to open in a browser.
