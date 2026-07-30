# Royal Fusion Environment Setup

Real environment values belong only in local ignored files or the deployment platform's secret manager. Never commit `.env`, `.env.local`, passwords, private tokens, service-role keys, or production customer data.

## Frontend

Put local frontend values in `frontend/.env.local`. Every variable beginning with `VITE_` is public because Vite includes it in the browser bundle.

| Variable | Purpose | Source |
| --- | --- | --- |
| `VITE_API_URL` | Public Express API base URL | Local backend URL or the deployed Belmo backend URL |
| `VITE_SUPABASE_URL` | Public Supabase project URL | Supabase project API settings |
| `VITE_SUPABASE_PUBLISHABLE_KEY` | Public Supabase publishable key | Supabase project API settings; safe only with correct RLS |
| `VITE_SANITY_PROJECT_ID` | Public Sanity project identifier | Sanity project settings |
| `VITE_SANITY_DATASET` | Public Sanity dataset name | Sanity project settings |
| `VITE_SANITY_API_VERSION` | Public Sanity API date | The API version selected by the development team |

These same six variables will later be configured in Vercel. The current code uses `VITE_API_URL`; the proposed name `VITE_API_BASE_URL` is not currently read by the application.

## Backend

Put local server values in `backend/.env`. This file already exists in some workspaces and must never be overwritten automatically.

Public operational configuration:

- `NODE_ENV`: runtime mode, such as development or production.
- `PORT`: Express listening port.
- `CLIENT_ORIGIN`: comma-separated exact frontend origins allowed by CORS. Put the canonical storefront origin first; successful Auth callbacks redirect there.
- `SUPABASE_URL`: Supabase project URL used by server integrations.
- `USE_SUPABASE`: set to `true` to initialize the backend Supabase client; `false` preserves the JSON workflow.
- `RF_DB_PATH`: optional path override for the prototype JSON database.

Server-only secrets:

- `AUTH_CSRF_SECRET`: signs session-bound CSRF values and callback state. Use a dedicated random value.
- `JWT_SECRET`: signs prototype administrator tokens in explicit non-production prototype mode only.
- `ADMIN_EMAIL`, `ADMIN_PASSWORD`, `ADMIN_NAME`: optional non-production prototype administrator setup. Production ignores automatic prototype setup.
- `SUPABASE_SECRET_KEY`: privileged Supabase key for Express only.
- `SANITY_API_TOKEN`: server token only if Express later performs authenticated Sanity operations.
- `SENTRY_DSN`: server monitoring configuration; treat it as restricted operational configuration.
- `RESEND_API_KEY`: server email credential.

Authentication configuration:

- `CUSTOMER_AUTH_PROVIDER` and `ADMIN_AUTH_PROVIDER`: `prototype` or `supabase`; production accepts only `supabase`.
- `ENABLE_GUEST_ORDER_LINKING`: server-controlled future flag; keep `false` until its approved branch is released.
- `ENABLE_ADMIN_MFA`: production must be `true`; enrollment and administration arrive in a later branch.
- `AUTH_SECURE_COOKIES`: production must be `true`.
- `AUTH_TRUST_PROXY`: production must be `true` behind the approved HTTPS proxy.
- `AUTH_ALLOW_DEV_LOOPBACK`: may be `true` only for explicit non-production loopback development.
- `AUTH_CALLBACK_URL`: HTTPS Express verification callback in production.
- `CUSTOMER_SESSION_IDLE_SECONDS`, `CUSTOMER_SESSION_ABSOLUTE_SECONDS`, `ADMIN_SESSION_IDLE_SECONDS`, and `ADMIN_SESSION_ABSOLUTE_SECONDS`: protected server session limits.
- `AUTH_ACCESS_COOKIE_SECONDS`, `AUTH_REFRESH_WINDOW_SECONDS`, and `AUTH_REFRESH_LEASE_SECONDS`: access-cookie and refresh-rotation controls.
- `AUTH_RECENT_AUTH_SECONDS`, `AUTH_RECOVERY_SESSION_SECONDS`, and `AUTH_VERIFICATION_STATE_SECONDS`: protected sensitive-action and callback limits.

`USE_SUPABASE` remains only the database-connectivity flag. It does not select either authentication provider. Catalog, checkout, order, and admin CRUD workflows still use JSON.

Belmo will later receive `NODE_ENV`, `PORT` if required by the platform, `CLIENT_ORIGIN`, the authentication configuration above, `AUTH_CSRF_SECRET`, `SUPABASE_URL`, and `SUPABASE_SECRET_KEY`. `JWT_SECRET` and prototype administrator values are not production Supabase Auth configuration. The current application does not read Cloudinary credentials or `DATABASE_URL`, so they have not been added yet.

The proposed names `FRONTEND_ORIGIN`, `SANITY_WRITE_TOKEN`, `CLOUDINARY_CLOUD_NAME`, `CLOUDINARY_API_KEY`, `CLOUDINARY_API_SECRET`, and `DATABASE_URL` are currently unused. Do not configure them until matching backend code is implemented or the existing names are intentionally migrated.

## Sanity Studio

Put local Studio configuration in `sanity/.env.local`:

- `SANITY_STUDIO_PROJECT_ID`
- `SANITY_STUDIO_DATASET`
- `SANITY_STUDIO_API_VERSION`

These are public Studio configuration values. They come from the Sanity project settings and the API version selected by the development team. Never put a Sanity write token in a `SANITY_STUDIO_` variable. The current `sanity` folder contains schema starters but no Studio package/configuration that reads these variables yet.

## Deployment Mapping

Vercel currently needs the six public `VITE_` variables listed in the frontend section. Belmo needs the backend variables actually used by Express. Sanity Studio variables belong in the Studio deployment environment after a Studio application is configured.

Do not create a root `.env`: no confirmed root-level script reads one. Workspace commands delegate to the frontend or backend, whose environment files belong in their own folders.

## Git Safety Check

From the repository root, confirm local files are ignored:

```bash
git check-ignore -v frontend/.env.local backend/.env sanity/.env.local
```

Confirm examples remain trackable and real environment files are not staged:

```bash
git status --short
git ls-files -- frontend/.env.local backend/.env sanity/.env.local
```

The second command must produce no file paths. Only `.env.example` files and this guide should be committed.
