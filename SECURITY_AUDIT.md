# MKM security review notes

## Scope

This is a repository-level implementation review for the mobile-readiness work, not a penetration test, production configuration review, or security certification.

## Controls inspected

- Authentication uses server-validated signed session cookies and checks the active database session and user status.
- Admin API routers apply authentication and admin-role middleware server-side; frontend route guards are not the authorization boundary.
- Mutating API requests require the configured trusted browser origin.
- Authentication routes use rate limiting; passwords are verified using Argon2.
- Financial operations use database transactions, server-side balance calculations, row locking, and idempotency in the inspected product/recharge/withdrawal paths.
- Payment proofs are stored in a private directory, checked by content type, and served through authenticated customer/admin endpoints.
- The PWA service worker added for this work excludes `/api/` requests and only caches static shell/assets. It does not cache balances, transactions, recharge details, withdrawal details, or other authenticated API responses.

## Not verified

- No live production environment, deployment secrets, HTTPS configuration, database certificate chain, backups, or infrastructure controls were available for inspection.
- No penetration test, cross-device browser matrix, or complete route-by-route authorization test was run as part of this change.
- No claim of complete security or production certification is made. Review environment-specific settings and test customer/admin separation against the deployed service before launch.
