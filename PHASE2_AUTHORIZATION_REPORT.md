# Phase 2: Authentication and authorization verification

## Scope and method

Inspected the authentication routes and middleware, frontend route guards, API mounting, and customer/admin resource routes. Ran HTTP tests against the Express app with disposable customer/admin accounts and resource fixtures in the configured PostgreSQL database. The fixtures were removed after testing. No production accounts were used. Tests below distinguish executed HTTP checks from source inspection and unavailable browser-profile checks.

## Architecture

- **Authentication:** login verifies the submitted password against the Argon2 hash in `users`. It creates a seven-day `auth_sessions` database row and returns a signed `mkm_session` JWT cookie.
- **Session validation:** each protected request verifies the JWT issuer, audience, subject, and session ID, then checks the matching database session is unrevoked and unexpired and the user is active. The JWT does not contain a role claim.
- **Identity and role:** `requireAuth` sets `request.auth.userId`, `sessionId`, and `role` from the joined database session/user row. `requireAdmin` requires that database-derived role to equal `ADMIN`.
- **Client storage:** application code has no `localStorage` or `sessionStorage` references. The frontend keeps the `/auth/me` or login response in React state. That state and the `/admin` route guard are UX controls; API middleware is the security boundary.
- **Logout:** the server attempts to revoke the database session, and the old cookie is rejected after successful revocation. The frontend currently suppresses logout API errors and clears its local UI state.

## Executed HTTP results

Ten representative admin read endpoints were exercised: dashboard, customers, recharges, withdrawals, tasks, rewards, support, settings, public-link settings, and audit logs.

| Check | Result | Evidence |
|---|---|---|
| Unauthenticated access to representative admin endpoints | **PASS** | All ten returned HTTP 401. |
| Authenticated customer access to those admin endpoints | **PASS** | All ten returned HTTP 403. |
| Authenticated admin access to those admin endpoints | **PASS** | All ten returned HTTP 200. |
| Role spoofing in login body/query and protected API query/body | **PASS** | Customer remained CUSTOMER; admin remained ADMIN; spoofed admin mutation returned 403. |
| Tampered signed session cookie | **PASS** | `/api/auth/me` returned HTTP 401. |
| Separate customer/admin HTTP cookie jars | **PASS** | Each continued to authenticate only its own user; logging out the customer did not affect the admin cookie. |
| Wallet ownership | **PASS** | A distinct foreign test-wallet balance was returned only to its owner, not when the customer supplied that user's ID in the query. |
| Profile ownership | **PASS** | `/api/profile` returned the authenticated customer's ID despite a foreign `userId` query parameter. |
| Transaction, purchase, recharge, and withdrawal history ownership | **PASS** | Foreign fixture records were absent from the customer's responses even when a foreign `userId` was supplied. |
| Referral-member ownership | **PASS** | Looking up a non-team customer returned HTTP 404. |
| Foreign recharge proof upload | **PASS** | With a valid PNG fixture, upload returned HTTP 404 and left the foreign recharge unchanged. |
| Foreign recharge/withdrawal cancellation | **PASS** | Both attempts were rejected and the other customer's records remained PENDING. |
| Logout session invalidation | **PASS** | After logout, the copied old cookie received HTTP 401 from `/api/auth/me`, `/api/dashboard`, and `/api/admin/dashboard`. |
| Trusted origin on mutation | **PASS** | An untrusted Origin received HTTP 403. |
| CORS credentials/origin | **PASS** | Response allowed the configured `http://localhost:5173` origin with credentials; it did not return `*`. |

## Cookie and CORS findings

The observed development login cookie was `HttpOnly`, `SameSite=Lax`, `Path=/`, and had a seven-day Max-Age. It had no `Domain` attribute, making it host-only. `Secure` is conditional on `NODE_ENV=production`; it was absent in this local development test and is enabled by the code in production. JWT and database session expiry are also seven days.

CORS uses `CLIENT_URL` (fallback `http://localhost:5173`) with credentials enabled. No wildcard origin is configured. The API also checks Origin on state-changing `/api` requests.

## Findings and recommended fixes

1. **Logout response does not expire the browser cookie — confirmed.** The logout response returned `Max-Age=604800` and a future expiry, rather than expiring `mkm_session`. The database session is revoked and the copied cookie is rejected in normal operation, but the browser retains a dead cookie. Clear-cookie options should omit the login `maxAge` and set an immediate expiry.
2. **Logout errors can be reported as success — confirmed by code inspection, failure path not fault-injected.** The logout endpoint catches errors from JWT verification and database revocation together, then returns success; the frontend also suppresses logout request errors. If database revocation fails, the server-side session may remain valid even though the UI says the user logged out. Handle invalid/expired tokens separately from revocation failures, return an error when revocation fails, and avoid presenting failed server logout as successful.
3. **Browser-profile isolation and customer-authenticated direct navigation were not exercised in real browser contexts.** Independent HTTP cookie jars were tested successfully, and source inspection confirms `/admin` checks the in-memory role while backend admin middleware enforces authorization. The available shared browser page could not be accessed for runtime testing. Repeat those two checks in separate browser profiles before deployment.

No cross-customer data disclosure or customer-to-admin API bypass was observed in the executed tests. No authentication code was changed during this verification.

## Required final status

| Test | Status |
|---|---|
| Unauthenticated protected admin API access returns 401 | **PASS** |
| Customer protected admin API access returns 403 | **PASS** |
| Admin protected API access is authorized | **PASS** |
| Client-supplied role/user ID/admin flags cannot spoof API identity | **PASS** |
| Separate API sessions remain isolated | **PASS** |
| Separate real browser profiles remain isolated | **NEEDS FIX** — not executed |
| Logout invalidates server session and protected API requests fail | **PASS** |
| Logout removes the browser cookie | **FAIL** — observed cookie remains valid for its configured lifetime, though its database session is revoked |
| Logout revocation failure is surfaced rather than reported as success | **NEEDS FIX** — failure path identified in code, not fault-injected |
| Tested customer resource ownership/IDOR cases | **PASS** |
| Customer direct navigation to `/admin` in a real browser | **NEEDS FIX** — source guard inspected, browser test not executed |
| Role-based frontend authorization relies only on browser storage | **PASS** — no local/session storage use found; frontend state is not the backend boundary |
| Cookie attributes and CORS configuration | **PASS** for the configured behavior described above |
