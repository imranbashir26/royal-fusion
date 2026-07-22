# Royal Fusion

Royal Fusion is a luxury perfume eCommerce prototype with a React storefront, admin dashboard, and Express API. The repository is split into independent frontend and backend workspaces while keeping root-level project documentation.

## Structure

```text
Royal Fusion/
├─ frontend/          # Vite, React, TypeScript, Tailwind, storefront/admin UI
├─ backend/           # Express API, JSON prototype DB, uploads, Supabase, Sanity
├─ PROJECT_CONTEXT.md
├─ PRODUCTION_READINESS.md
├─ BACKEND_PLAN.md
├─ ADMIN_MANAGEMENT_DOCS.md
├─ package.json       # workspace/orchestration commands
└─ package-lock.json  # npm workspace lockfile
```

## Install

Install all workspaces from the root:

```bash
npm install
```

Or install independently:

```bash
cd frontend && npm install
cd backend && npm install
```

## Development

Run the frontend:

```bash
npm run dev:frontend
```

Run the backend API:

```bash
npm run dev:backend
```

Run both:

```bash
npm run dev:full
```

Local URLs:

- Frontend: `http://localhost:5173`
- API health: `http://127.0.0.1:4177/api/health`

## Environment Files

- Frontend browser-safe variables belong in `frontend/.env`.
- Backend/server-only variables belong in `backend/.env`.
- Use `frontend/.env.example` and `backend/.env.example` as templates.

Never expose `SUPABASE_SECRET_KEY`, `SANITY_API_TOKEN`, or other privileged secrets in frontend/Vite code.

## Prototype Database

The live JSON database is `backend/server/data/db.json` and is ignored because it can contain admin users, password hashes, customers, orders, messages, and subscribers. A sanitized starter file is kept at `backend/server/data/db.example.json`; the backend copies it to `db.json` automatically when a local database does not exist.

## Useful Commands

```bash
npm run build
npm run lint
npm run api:smoke
npm run env:check:prod
npm run admin:create -- --email owner@example.com --password "StrongPassword123!" --name "Owner Name"
```
