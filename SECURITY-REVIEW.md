# MKM Security Review

## Scope

This review focused on customer/admin access control, authentication sessions, and the pre-deployment security concerns reported for the MKM application. It identified two actionable issues. The reviewed backend admin routers independently require authentication and administrator authorization; no customer-to-admin API authorization bypass was confirmed.

## Findings and remediation

| # | Original severity | Finding | Status |
|---|---|---|---|
| 1 | High | Remote PostgreSQL TLS accepted untrusted certificates because `rejectUnauthorized` was disabled. | Fixed: certificate verification is enabled in the shared pool. Ensure the database CA is trusted by Node.js (use `NODE_EXTRA_CA_CERTS` when the provider uses a private CA). |
| 2 | Medium | Cookie-authenticated state-changing API requests did not validate their browser origin, allowing cross-origin form submissions from a same-site attacker-controlled origin. | Fixed: unsafe `/api` methods now require an `Origin` matching the configured `CLIENT_URL`; missing, malformed, and untrusted origins are rejected. Safe methods and CORS preflight are not blocked. |

## Verification

- Automated middleware tests cover valid, missing, malformed, and untrusted origins and safe methods.
- Backend tests and the client production build should pass before deployment.
- Confirm production `CLIENT_URL` is the exact HTTPS frontend origin and that the PostgreSQL certificate chain is trusted in the deployment runtime.

## Deployment considerations

The origin check is defense-in-depth for cookie-authenticated browser requests, not a substitute for authorization. Continue to require `requireAuth` and `requireAdmin` on protected routes. Non-browser API clients making state-changing requests must send the configured `Origin` header or use a separately designed authentication strategy.

This review is not a guarantee that all security issues have been found. Validate session expiration/revocation, database/network policies, production secrets, HTTPS, backups, and dependency status in the actual deployment environment.
