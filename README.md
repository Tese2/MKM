# MKM

MKM is a full-stack fintech and commerce platform with a React frontend, Express backend, and PostgreSQL persistence.

## Stack

- Frontend: React + Vite
- Backend: Node.js + Express
- Database: PostgreSQL
- Auth: JWT + secure cookies + Argon2 password hashing
- Financial logic: wallet ledger + transaction records + idempotency checks

## Project structure

- `client/` — Vite frontend app
- `server/` — Express API server
- `database/` — SQL migrations and seeds
- `docs/` — supporting documentation

## Local setup

1. Copy the example env file:
   ```bash
   copy .env.example .env
   ```
2. Update the values in `.env` for your local PostgreSQL database, JWT secret, and app URLs.
3. Install dependencies:
   ```bash
   npm install
   ```
4. Run database migrations:
   ```bash
   npm run db:migrate
   ```
5. Run seeds if needed:
   ```bash
   npm run db:seed
   ```
6. Start the app:
   ```bash
   npm run dev
   ```

## Local URLs

- Frontend: http://localhost:5173
- Backend: http://localhost:4000
- Health check: http://localhost:4000/health
- API health check: http://localhost:4000/api/health

## Useful commands

```bash
npm test
npm --prefix client run build
npm run db:check
npm run db:migrate
npm run db:seed
```

## Security notes

- Do not commit `.env` files.
- Keep secrets in environment variables.
- Treat all balance, reward, pricing, and admin actions as server-side controlled business logic.
- Do not expose private files or account proof uploads publicly.

## Notes

This project includes working wallet and financial foundation logic, admin routes, customer flows, support config, and app download configuration. The codebase remains under active business-spec verification, so any deployment or production rollout should be reviewed against the exact legal, financial, and operational requirements of the business.
