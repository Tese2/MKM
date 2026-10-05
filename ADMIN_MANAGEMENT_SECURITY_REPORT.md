# MKM — Admin Management, Customer Deactivation & Admin Profile Security Report

**Date:** 2026-10-04  
**Status:** Implemented, Tested & Verified  
**Regression Status:** 48/48 tests passing (0 failures)

---

## 1. Customer Management Implementation

The Admin Customer Management module was enhanced to provide administrative visibility, account control, and inspection capabilities while preserving MKM's financial integrity:

- **Enhanced Customer Listing (`/admin/customers`):**
  - Displays customer full name, Ethiopian phone number, referral code, registration date, role, account status badge (`ACTIVE`, `SUSPENDED`, or `DEACTIVATED`), and payout accounts.
  - Displays live wallet balances: Available balance (ETB) and Locked balance (ETB).
  - Search filter by Name, Phone, or Referral Code.
  - Dedicated Status filter dropdown: `All Statuses`, `Active`, `Suspended`, and `Deactivated`.
  - Pagination controls preserving query filters.
- **Detailed Financial Overview Inspection:**
  - An interactive **"View details"** action loads comprehensive live financial metrics for the customer:
    - Approved deposit totals & count (`recharge_requests`)
    - Completed payout totals & count (`withdrawals`)
    - Active product packages count (`product_purchases`)
    - Available and locked balances (`wallets`)
    - Last 10 ledger transactions with direction and status (`transactions`)

---

## 2. Customer Deletion & Deactivation Strategy

MKM contains immutable financial and ledger records. Deleting records via `DELETE FROM users` would cascade or break foreign keys on wallets, ledger entries, recharge receipts, payout requests, and audit logs.

### Soft-Deactivation Strategy:
Instead of destructive deletion, customer deactivation is implemented as a **safe soft-deactivation**:
1. Target customer's `status` is transitioned to `'DEACTIVATED'` (or `'SUSPENDED'`).
2. Immediate session revocation: All active customer sessions in `auth_sessions` are revoked (`revoked_at = now()`).
3. Authentication gate: The session middleware checks `u.status = 'ACTIVE'`. Any request with an existing session cookie is immediately rejected with `401 SESSION_EXPIRED`.
4. Password and login gate: Deactivated users cannot log in.
5. Financial Preservation:
   - Wallets, ledger rows, recharge history, withdrawal records, product purchases, and daily task forecasts remain 100% intact.
   - Financial auditability is maintained without orphan records.
6. Reactivation: Administrators can reactivate an account (`status = 'ACTIVE'`) with a single click.

---

## 3. Admin Profile Implementation

Added a dedicated **My Profile** section (`/admin/profile`) to the Admin Dashboard:
- **Account Overview:**
  - Displays Administrator Name, Ethiopian Phone number, Role (`ADMIN`), Status badge, and Registration date.
  - Displays Assigned Privileges: Shows "★ Full Unrestricted Privileges (Super Admin)" for Super Admins, or individual privilege tags (e.g. `CUSTOMER_VIEW`, `RECHARGE_APPROVE`, etc.).
- **Edit Personal Information:**
  - Allows the authenticated administrator to update their own full name and phone number.
  - Validates Ethiopian phone number format (`^[97][0-9]{8}$`) and checks uniqueness across all accounts.
  - Scoped strictly to `request.auth.userId`, preventing any administrator from tampering with other admins via this endpoint.
- **Admin Password Change:**
  - Requires confirmation of current password.
  - Validates new password length (min 6, max 128 characters) and password match.
  - Hashes passwords using Argon2id.
  - Automatically revokes all other active sessions for that admin account, preventing session hijacking.
  - Rate-limited to 10 requests per user window.
  - Records an `ADMIN_PASSWORD_CHANGE` audit log.

---

## 4. Admin Creation Implementation

An authorized administrator can add new administrators via the **Admin Management** page (`/admin/admins`):
- **Input Validation:**
  - Full name (2–120 characters)
  - Ethiopian phone number (`^[97][0-9]{8}$`) with database uniqueness constraint
  - Password and confirmation (min 6 characters)
- **Security:**
  - Password is hashed using Argon2id (`argon2.hash(password, { type: argon2.argon2id })`). Plaintext passwords are never stored, logged, or returned.
  - Automatically generates an internal referral code (`ADM-XXXXXXXX`).
  - Creates a dedicated wallet record for the admin.
  - Runs in an atomic database transaction.
  - Emits an `ADMIN_CREATE` audit log.

---

## 5. Admin Privilege & RBAC Implementation

Implemented a 16-point Granular Role-Based Access Control (RBAC) system:

```text
CUSTOMER_VIEW         — View customer directory and details
CUSTOMER_MANAGE       — Edit, deactivate, and suspend customer accounts
PRODUCT_VIEW          — View product catalog
PRODUCT_MANAGE        — Create, edit, and configure products
RECHARGE_VIEW         — View recharge requests and proof
RECHARGE_APPROVE      — Approve or reject customer recharge requests
WITHDRAWAL_VIEW       — View withdrawal requests
WITHDRAWAL_APPROVE    — Approve, reject, and process payout requests
TRANSACTION_VIEW      — View wallet ledger and financial transactions
TASK_VIEW             — View daily tasks and completion progress
TASK_MANAGE           — Manage daily tasks and rewards
REFERRAL_VIEW         — View multi-level referral network and commissions
SETTINGS_VIEW         — View system settings and public links
SETTINGS_MANAGE       — Update platform settings, fees, and links
ADMIN_VIEW            — View administrators and assigned privileges
ADMIN_CREATE          — Create new administrator accounts
ADMIN_MANAGE          — Edit privileges and manage admin status
```

### Hierarchy & Super Admin Protection:
- `is_super_admin`: Super Administrators have unrestricted access (`*`) to all system functions.
- Only a Super Administrator can promote another administrator to Super Admin.
- Non-super administrators with `ADMIN_CREATE` or `ADMIN_MANAGE` can only grant privileges that they themselves possess.
- Non-super administrators cannot edit, demote, or deactivate a Super Administrator.

---

## 6. Session Revocation

When an account is deactivated or its credentials are changed:
1. **Immediate Revocation:**
   ```sql
   UPDATE auth_sessions SET revoked_at = now()
   WHERE user_id = $1 AND revoked_at IS NULL;
   ```
2. **Session Verification:**
   The `requireAuth` middleware verifies:
   ```sql
   WHERE s.id = $1 AND s.user_id = $2
     AND s.revoked_at IS NULL
     AND s.expires_at > now()
     AND u.status = 'ACTIVE'
   ```
   Both the `revoked_at` timestamp and the `u.status = 'ACTIVE'` condition ensure immediate disconnection without waiting for cookie expiration.

---

## 7. Database Changes

Migration **`009_admin_management_and_privileges.sql`** applied safely:

```sql
ALTER TABLE users ADD COLUMN IF NOT EXISTS is_super_admin BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE users ADD COLUMN IF NOT EXISTS privileges JSONB NOT NULL DEFAULT '[]'::jsonb;

ALTER TABLE users DROP CONSTRAINT IF EXISTS users_status_check;
ALTER TABLE users ADD CONSTRAINT users_status_check CHECK (status IN ('ACTIVE', 'SUSPENDED', 'DEACTIVATED'));

-- Ensure any existing administrators have full administrative privileges
UPDATE users
SET is_super_admin = true,
    privileges = '["*"]'::jsonb
WHERE role = 'ADMIN';
```

---

## 8. API Endpoints

| Method | Endpoint | Authorization | Description |
|---|---|---|---|
| `GET` | `/api/admin/customers` | `CUSTOMER_VIEW` | Search and paginate customers with status filter |
| `GET` | `/api/admin/customers/:id` | `CUSTOMER_VIEW` | Customer financial summary, wallet, transactions |
| `PATCH` | `/api/admin/customers/:id/status` | `CUSTOMER_MANAGE` | Change status (`ACTIVE`, `SUSPENDED`, `DEACTIVATED`) |
| `DELETE` | `/api/admin/customers/:id` | `CUSTOMER_MANAGE` | Soft-deactivate customer, revoke sessions |
| `GET` | `/api/admin/profile` | `ADMIN` | Get authenticated admin profile & privileges |
| `PATCH` | `/api/admin/profile` | `ADMIN` | Update authenticated admin name and phone |
| `PATCH` | `/api/admin/profile/password` | `ADMIN` (Rate-limited) | Change admin password, revoke other sessions |
| `GET` | `/api/admin/admins` | `ADMIN_VIEW` | List all administrator accounts and privileges |
| `POST` | `/api/admin/admins` | `ADMIN_CREATE` | Create new admin with Argon2id hash & privileges |
| `PATCH` | `/api/admin/admins/:id` | `ADMIN_MANAGE` | Update admin privileges, status, or details |
| `DELETE` | `/api/admin/admins/:id` | `ADMIN_MANAGE` | Deactivate admin, revoke sessions |

---

## 9. UI Changes

- **Navigation:**
  - Added **Admin Management** (`/admin/admins`) to sidebar and mobile menu.
  - Added **My Profile** (`/admin/profile`) to sidebar and mobile menu.
  - Preserved `/admin/password` for backward compatibility.
- **Customers Table:**
  - Status column with colored badges (`ACTIVE` green, `DEACTIVATED` red, `SUSPENDED` red).
  - Dual wallet balances displayed for each customer.
  - Action buttons: "View details", "Reset password", and "Deactivate" / "Reactivate".
  - Confirmation drawer for customer deactivation explaining session revocation and history preservation.
  - Detailed financial overview card for single customer inspection.
- **Admin Management View:**
  - Table of all administrators with roles, privileges pills, and statuses.
  - `+ Add New Admin` modal with Ethiopian phone validation, password confirmation, super admin toggle, and multi-select privilege checkboxes.
  - `Edit Privileges` modal for adjusting individual permissions.
  - Protection guards preventing self-deactivation.
- **Admin Profile View:**
  - Overview card showing name, phone, access level, and privileges.
  - Edit profile card.
  - Password change card with other-session revocation notices.

---

## 10. Responsive Styling

- All tables use `.table-wrap` for horizontal scrolling on mobile devices.
- Search and filter controls stack into responsive grids on small viewports.
- Added CSS support for status badges:
  - `.status-active` (`#dff3e7`, green)
  - `.status-suspended`, `.status-deactivated` (`#fde7e7`, red)
- Mobile drawer navigation updated to include the new admin routes.

---

## 11. Audit Logging

Sensitive actions write audit entries to the existing `audit_logs` table:
- `CUSTOMER_DEACTIVATE` (records customer ID, previous status, reason, revoked sessions)
- `CUSTOMER_REACTIVATE`
- `ADMIN_CREATE` (records admin ID, assigned privileges, super admin status)
- `ADMIN_UPDATE` / `ADMIN_PRIVILEGE_UPDATE`
- `ADMIN_DEACTIVATE`
- `ADMIN_PROFILE_UPDATE`
- `ADMIN_PASSWORD_CHANGE`

Plaintext passwords, password hashes, and session tokens are strictly excluded from audit logs.

---

## 12. Security Protections Enforced

- ✅ **Self-Deactivation Protection:** Admin cannot deactivate their own active account.
- ✅ **Last Admin Protection:** System blocks removing the last active administrator with management rights.
- ✅ **Privilege Escalation Prevention:**
  - Non-super admins cannot grant Super Admin status.
  - Non-super admins cannot grant privileges they do not possess.
  - Non-super admins cannot modify or deactivate Super Administrators.
- ✅ **Customer Protection:** Admin accounts cannot be deactivated through customer endpoints.
- ✅ **Server-Side Validation:** All role checks, privilege checks, and phone formats are validated server-side.
- ✅ **Argon2id Hashing:** Industry-standard Argon2id hashing used for all passwords.
- ✅ **Rate Limiting:** Mutation and password endpoints protected by per-user rate limiters.
- ✅ **Financial Immutability:** No financial records are deleted when users are deactivated.

---

## 13. Regression & Test Results

```text
Existing tests: 40 passed
New tests:       8 passed
Total:          48 passed
Failures:        0
```

### Full Test Suite Breakdown:
1. `normalizePrivileges filters invalid privileges and preserves project permissions` (PASS)
2. `hasPrivilege accurately checks super admin and specific permissions` (PASS)
3. `requireAdminPrivilege middleware enforces RBAC access control` (PASS)
4. `customer deactivation rejects self-deactivation and enforces non-customer protection` (PASS)
5. `admin management protects against privilege escalation and last admin removal` (PASS)
6. `password hashing and verification adheres to Argon2id standards` (PASS)
7. `customer deactivation updates status, revokes sessions, and preserves all financial tables` (PASS)
8. `admin creation creates active admin with privileges and wallet` (PASS)
9. Plus 40 existing regression tests covering daily tasks, financial foundation, referral engine, rate limiters, bank validation, and settings (ALL PASS).

### Client Build Verification:
```text
✓ 1593 modules transformed.
dist/index.html                   0.78 kB │ gzip:   0.42 kB
dist/assets/index-BLiJ5Zgw.css   50.35 kB │ gzip:  10.92 kB
dist/assets/index-BANLBw3h.js   378.38 kB │ gzip: 102.98 kB
✓ built in 5.79s (Zero build or JSX errors)
```
