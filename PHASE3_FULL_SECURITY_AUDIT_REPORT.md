# MKM Phase 3 Full Security Audit

## 1. Audit scope

Read-only source review of the full current repository and pre-existing uncommitted worktree changes, followed by focused dependency, build, and unit-test verification. This audit did not connect to or mutate the configured remote PostgreSQL database, use real customer data, approve financial activity, or test the production deployment. No secrets were printed.

Branch: `development`  
Baseline commit: `94dc212`  
Node used for validation: v24.21.0  
Minimum supported Node version changed from 18 to 20 to support patched dependencies.

The source-level security review found no confirmed data-theft, privilege-escalation, or financial-integrity exploit. The dependency scan did find advisories, which were updated and retested. This report distinguishes local source/test results from runtime and production checks that were not performed.

## 2. Architecture reviewed

React/Vite SPA, Express API, PostgreSQL, signed `mkm_session` JWT cookie backed by database sessions, `CUSTOMER` and `ADMIN` roles. Authentication, financial logic, authorization, storage, migrations, dependency manifests/lockfile, and client routing were reviewed.

## 3. Authentication — PASS (source); runtime regression not rerun

Login/register inputs are schema-validated; passwords are Argon2-verified/hashed; inactive users are rejected. Identity, role, and user ID are loaded from the database session for protected API requests, not accepted from browser role fields. Prior Phase 2 and Phase 2.1 reports record executed HTTP/browser authorization and logout tests; those scenarios were not repeated against the configured remote database for Phase 3.

## 4. Session security — PASS (source and prior Phase 2.1 tests)

Sessions are signed, database-backed, seven-day sessions. Middleware checks JWT issuer/audience, session ID, subject, revocation, expiry, and active user state on each protected request. Cookie uses `HttpOnly`, `SameSite=Lax`, `Path=/`, no explicit `Domain`, and `Secure` when `NODE_ENV=production`. Phase 2.1 records customer/admin isolation, logout revocation, copied-cookie replay rejection, and cookie-expiry checks. Production Secure-cookie behavior was not exercised on a deployed HTTPS host.

## 5. Authorization/RBAC — PASS (source and prior representative tests)

Protected admin routers enforce `requireAuth` and `requireAdmin`; customer endpoints use authenticated identity. The frontend `/admin` redirect is UX only. The backend is the authorization boundary. Phase 2/2.1 reports record unauthenticated admin API 401, customer 403, and admin access success on representative protected routes. A fresh exhaustive endpoint-by-endpoint HTTP matrix was not run in Phase 3.

## 6. IDOR/ownership — PASS (source and prior Phase 2 tests)

Customer profile, wallet, transactions, recharge, withdrawal, notification, and account queries use the authenticated user ID. Admin access to proof files is authorized. Prior Phase 2 reports document foreign-object checks using disposable fixtures. No Phase 3 foreign-object tests were run against the remote database.

## 7. Input validation — PASS (source)

Zod schemas and database constraints validate IDs, roles, amounts, dates, pagination, account details, statuses, and settings. File-size and signature checks are used for uploaded images and recharge proofs. Malformed-input fuzzing was not performed in Phase 3.

## 8. SQL injection — PASS (source)

Reviewed request-derived SQL values are parameterized. Dynamic SQL fragments are assembled from validated filter choices and generated placeholder positions; user values are bound parameters. No destructive SQL probes were sent.

## 9. XSS — PASS (source)

No `dangerouslySetInnerHTML`, `innerHTML`, `eval`, or `new Function` usage was found in client source. React renders user-supplied text as escaped content. Harmless browser payloads were not submitted to the live application.

## 10. CSRF — PASS (source and prior tests)

Mutating `/api` requests require a trusted `Origin` matching configured `CLIENT_URL`; safe methods are exempt. Prior Phase 2.1 report records an untrusted mutation origin receiving 403. Browser-specific cross-site cookie behavior was not retested in Phase 3.

## 11. CORS — PASS (source and prior tests)

CORS is configured for one `CLIENT_URL` with credentials; wildcard `*` is not combined with credentials. Prior Phase 2 reports record configured-origin and untrusted-origin checks. Production-origin behavior was not checked.

## 12. Security headers — PASS (source); deployment needs verification

`helmet()` is installed at the Express app entry point and `x-powered-by` is disabled. Actual response headers behind the production proxy were not observed; HSTS/TLS behavior remains a deployment check.

## 13. Rate limiting — PASS for audited mutation routes (unit test); deployment store needs attention

Login and registration have a 10-request/15-minute limiter. Phase 3 added a per-authenticated-user limit of 20 requests per 15 minutes before customer recharge submission/proof parsing, withdrawal creation, reward claims, and admin image-upload parsing. A focused test verifies 429 behavior and independent user buckets.

The limiter uses the package’s in-memory store. In a multi-process or multi-instance deployment, limits are not shared; configure a shared store before scaling. Manual recharge/withdrawal review and approval behavior was not changed.

## 14. Financial security — PASS (source and existing unit tests); live flows not retested

Server-side amounts, product prices, wallet balances, withdrawal rules, and reward eligibility are authoritative. Wallet changes use transactions, row locks, and non-negative-balance guards. Recharge and withdrawal approvals remain explicit admin/manual actions. Phase 3 did not approve or alter any real financial records.

## 15. Race conditions — PASS (source/unit tests); live concurrency not run

Wallet movement and withdrawal flows use database transactions/locks and applicable unique constraints. Existing financial tests include concurrent wallet debit coverage. Simultaneous operations were not sent to the configured remote database.

## 16. Idempotency/replay — PASS (unit tests); broader runtime replay not rerun

Existing idempotency tests cover same-key replay, mismatched payload rejection, concurrency, and rollback. User/admin lifecycle endpoints also validate current record state to reject duplicate transitions. This Phase 3 review did not replay financial requests against live data.

## 17. File uploads — PASS after dependency fix; runtime parser fuzzing not run

Uploads enforce per-file size/count limits and inspect actual file signatures. Proof uploads use private storage and random names; admin image uploads allow only detected JPEG/PNG/WEBP and random UUID filenames. Public image files are intentionally served from the separate public upload directory.

## 18. Payment proof privacy — PASS (source and prior Phase 2 ownership tests)

Proof files are not mounted as public static files. Customer/admin endpoints authenticate and authorize access before streaming. Prior Phase 2 report records a foreign proof access test. No proof file was fetched in this audit.

## 19. Admin security — PASS (source and prior representative HTTP tests)

Admin mutations and reads are protected with backend role middleware. Admin identity is derived from the server-side session. Financial and settings changes have audit records in the reviewed routes. The entire route matrix was not dynamically exercised in Phase 3.

## 20. Referral/reward abuse — PASS (source/unit tests); live end-to-end not run

Referral links and commissions are server-generated and use database constraints/transactions. Reward milestone eligibility uses approved credited deposits; duplicate claims are constrained and checked server-side; approval and payment are admin operations. Existing unit tests cover reward summaries, eligibility calculation, referral code validation, commission arithmetic, and wallet movement. Full claim/approve/reject/pay scenarios were not run against database fixtures in Phase 3.

## 21. API security — PASS (source); runtime coverage limited

JSON bodies are capped at 32 KiB; multipart routes cap files at 5 MiB and one file. Authenticated customer mutations and costly uploads now have per-user throttles. Protected routes do not trust browser state for roles. Unexpected-method behavior was not exhaustively tested.

## 22. Error handling — PASS (source)

The common API handler returns generic 5xx messages instead of exception details. Application logs are inspected for accidental secret output; no password/session token logging was found. A production failure injection was not performed.

## 23. Database security — NEEDS ATTENTION (database configuration not inspected)

Migrations define foreign keys, unique/check constraints, indexes, and numeric financial columns. Queries are parameterized and financial writes are transactional. Database role grants, backups, network policy, production schema state, and remote migration state were not inspected because the configured database is remote and no audit database changes were authorized.

## 24. Secrets/environment — NEEDS ATTENTION (deployment state unavailable)

`.env.example` contains placeholders; `.gitignore` excludes `.env`; source reads secrets from environment. Secret strength/rotation in deployment and provider secret-manager controls were not verified. No actual secret values were disclosed.

## 25. Dependencies — PASS after upgrade (npm audit)

Before update, `npm audit` reported moderate advisories affecting `file-type` 20.5.0 and `react-router`/`react-router-dom` 6.30.6. `file-type` is used on untrusted upload buffers; its advisories concern denial of service. React Router's open-redirect advisory was reviewed; no attacker-controlled external navigation destination was found. Its SSR hydration advisory does not match the current client-only `createRoot`/`BrowserRouter` app.

Updated to `file-type` 21.3.4 and React Router 7.18.4. Root minimum Node engine is now `>=20`. Full `npm audit --audit-level=moderate` reports zero vulnerabilities. Client build and server tests pass on Node 24.21.0. Node 20 itself was not used for validation.

## 26. Production configuration — NEEDS ATTENTION

HTTPS termination, TLS certificates, proxy configuration, production CORS origin, production Secure cookies, shared rate-limit store, deployed Node version, logging, and live database SSL/permissions were not validated. The current environment's configured database target is remote; it was not queried or changed.

## 27. Audit logging — PASS (source review); persistence not dynamically checked

Reviewed admin settings/product and financial transitions write audit-log rows. Passwords and session tokens are not intentionally stored in audit metadata. No live audit records were generated or inspected in Phase 3.

## 28. Regression tests — PASS (local checks); Phase 2/2.1 not rerun

- Server tests: **40 passed, 0 failed**, including the new per-user limiter test.
- Client production build: **passed** with React Router 7.
- Full dependency audit: **0 vulnerabilities**.
- `git diff --check`: passed.
- Editor diagnostics: no issues reported in changed source files.
- Phase 2 and Phase 2.1 authorization/logout browser/API results remain documented in their existing reports and were not repeated against the remote database in this phase.

## Findings table

| ID | Severity | Area | Finding | Evidence | Fix | Retest |
|---|---|---|---|---|---|---|
| P3-01 | MODERATE (resolved) | Dependencies / uploads | Installed `file-type` version was within two published DoS advisory ranges; untrusted upload bytes reach signature detection. | `npm audit` before update; package used by recharge and admin image uploads. | Upgraded to `file-type` 21.3.4; kept signature validation and 5 MiB limits. | Full npm audit: zero vulnerabilities; server tests pass. No malformed-buffer stress test run. |
| P3-02 | MODERATE (resolved) | Dependencies / client routing | Installed React Router 6.30.6 was in advisory ranges. SSR hydration issue is not applicable to the current SPA; no attacker-controlled external navigation destination was found for the open-redirect advisory. | `npm audit` before update; client uses `BrowserRouter` and `createRoot`. | Upgraded to React Router 7.18.4 and raised minimum Node to 20. | Full npm audit: zero vulnerabilities; production client build passes. Browser adversarial-navigation test not run. |
| P3-03 | MEDIUM (mitigated) | Rate limiting / resource exhaustion | Before Phase 3, authenticated recharge/proof uploads, withdrawal submissions, reward claims, and admin image uploads had no route-level throttling. Repeated requests could consume database, parser, and persistent file-storage resources. | Route and middleware source review; no limiter on those routes before this change. | Added 20-request/15-minute per-user limit ahead of multipart parsing or database work on these mutation routes. Manual review/approval is unchanged. | Focused integration test confirms per-user isolation and HTTP 429; full server tests pass. Limiting is per-process memory, so multi-instance deployment needs a shared store. |

No unresolved, confirmed source-level confidentiality, authentication-bypass, authorization, or wallet-integrity exploit was identified in the reviewed code. The limitations below are not represented as passed tests.

## Production readiness

### CRITICAL ISSUES

None confirmed by source review.

### HIGH ISSUES

None confirmed by source review.

### MEDIUM ISSUES

The upload/parser and React Router advisories and missing route throttles were addressed as listed above. A shared rate-limit store is needed if deployed across multiple instances.

### LOW ISSUES

No additional confirmed exploit identified.

### NOT TESTED

- Production HTTPS/TLS, HSTS, reverse proxy, cookie behavior, and deployment origin.
- Real remote PostgreSQL permissions, backup/network controls, migration state, and concurrency.
- Full disposable-account Phase 3 endpoint/IDOR matrix, SQL probes, XSS browser payloads, upload malformed-input stress, and all manual financial lifecycle flows.
- Node 20 runtime specifically (validation used Node 24.21.0).
- Shared rate-limit behavior in a horizontally scaled deployment.
- Cleanup SQL count from the supplied prompt. No Phase 3 test accounts or database records were created, so cleanup was not needed; the remote database was intentionally not queried.

NOT READY FOR PRODUCTION

## Cleanup

No disposable test accounts, financial records, uploads, or database fixtures were created for this audit. No cleanup query was run because the configured database is remote and no database access was required. No real customer data or balances were modified.

## Git final check

No commit or push was made. The branch remains `development`. The worktree was already dirty from earlier requested work; those earlier edits were preserved.

Audit-specific files changed:

- `package.json`
- `package-lock.json`
- `server/package.json`
- `client/package.json`
- `server/src/middleware/userRateLimit.js` (new)
- `server/src/routes/recharges.js`
- `server/src/routes/withdrawals.js`
- `server/src/routes/portal.js`
- `server/src/routes/uploads.js`
- `server/test/user-rate-limit.test.js` (new)
- `PHASE3_FULL_SECURITY_AUDIT_REPORT.md` (new)

Pre-existing unrelated/uncommitted product work remains in the worktree and is not attributed to this audit.
