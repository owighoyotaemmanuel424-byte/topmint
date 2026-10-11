# TopMint Phase 7 — Master admin dashboard

## Implemented on this branch
- Shared master-admin shell and responsive table conventions.
- Server-side admin page guard for new nested admin pages.
- Live overview metrics from Prisma queries, including customer counts, deposits, pending withdrawals, active investments, invested principal, recorded returns, completed withdrawals and wallet balance totals.
- Paginated customer search/status filtering and reason-required suspend/reactivate API with audit entries.
- Paginated transaction monitoring with filters and read-only financial history.
- Paginated, searchable audit logs and a security-monitoring view.
- Nested routes for overview, customers, transactions, audit logs, investments, plans, notifications, settings and security.
- Reuses the existing Admin, User, Wallet, Deposit, Withdrawal, Investment, Transaction, Notification and AuditLog models; no financial schema reset or new financial ledger is introduced.

## Important metric semantics
- Verified deposits are sum of Deposit.amount for COMPLETED deposit rows.
- Pending deposit requests and pending withdrawals are amounts currently awaiting review, not revenue.
- Invested principal is principal associated with ACTIVE or COMPLETED investments.
- Recorded investment returns currently use Investment.actualReturn. The existing schema does not provide a universal canonical earnings-paid field, so do not interpret this as company revenue.
- Completed withdrawals are sum of Withdrawal.amount with COMPLETED status.
- Wallet balances are customer liabilities, not revenue.
- Figures are operational aggregates and should be reconciled with the ledger before use for financial reporting.

## Incomplete work
- No new payment-provider verification integration; existing deposit approval remains restricted to MANUAL deposits and requires the operator to affirm independent receipt verification.
- Existing withdrawal workflow is reused, but end-to-end payout-provider verification has not been added.
- Investment/plan pages reuse legacy screens; investment contract adjustment workflow and full plan audit integration require follow-up.
- Notification page reuses existing announcement interface; provider delivery tracking is not added.
- Settings are read-only status guidance; editable maintenance/limits controls and secret management are not implemented.
- Admin login rate limiting, failed-login event capture, MFA/re-authentication, and central admin session revocation need implementation.
- Role enum currently supports SUPER_ADMIN, ADMIN, SUPPORT; Finance Admin and Operations Admin are not added.
- Do not call this fully complete or production-ready until CI, Prisma validation, build, and authorization/business-rule tests pass.
