# MedConnect — Frontend

Next.js 16 (App Router) + TypeScript + Tailwind CSS v4. Talks to the FastAPI backend in
`../medconnect-backend`; video calls use LiveKit's React components.

## Run it

The backend must be running first (see `../medconnect-backend`):

```bash
cd ../medconnect-backend
docker compose up -d                 # Postgres (5434) + LiveKit (7880)
source venv/bin/activate
alembic upgrade head
uvicorn main:app --reload            # API on http://127.0.0.1:8000
```

Then, in a second terminal:

```bash
cd client
npm install                          # first time only
cp .env.example .env.local           # first time only
npm run dev                          # http://localhost:3000
```

If port 3000 is busy, Next.js picks the next free one and prints it.

| Script          | What it does                                  |
| --------------- | --------------------------------------------- |
| `npm run dev`   | Development server with hot reload            |
| `npm run build` | Production build (also type-checks)           |
| `npm run start` | Serve the production build                    |
| `npm run lint`  | ESLint                                        |

### Environment (`.env.local`)

| Variable                      | Default                     | Notes                                                        |
| ----------------------------- | --------------------------- | ------------------------------------------------------------ |
| `BACKEND_URL`                 | `http://47.129.242.10:8000` | FastAPI backend (AWS EC2). Use `http://127.0.0.1:8000` for a local backend. Restart `npm run dev` after changing it |
| `NEXT_PUBLIC_API_URL`         | `/api`                      | Leave unset. Only for calling the backend directly, bypassing the proxy |
| `NEXT_PUBLIC_CLINIC_TIMEZONE` | `Asia/Karachi`              | Must match the backend's `APP_TIMEZONE`                       |

The browser never calls the backend directly. It calls `/api/*` on this site, and
`next.config.ts` forwards those requests to `BACKEND_URL`. This is what lets the HTTPS site on
Vercel use a backend that's plain HTTP: browsers block an HTTPS page from calling an HTTP API.

## Deploy on Vercel

1. Import the repo in Vercel and set **Root Directory** to `client` (framework: Next.js).
2. Environment variables are optional: `BACKEND_URL` defaults to the EC2 address above. Set it
   in Project → Settings → Environment Variables if the backend moves, then redeploy (it's read
   at build time).
3. Video calls connect the browser **directly** to LiveKit, and don't go through the proxy. From
   an HTTPS site that needs a `wss://` LiveKit URL (TLS, so a domain name), and the EC2
   security group must allow LiveKit's ports (7880 TCP, 7881 TCP, 50000-50100 UDP).

## What's where

```
src/
  app/                         routes (App Router)
    page.tsx                   home
    doctors/                   search, doctor profile + booking
    login, register, forgot-password, reset-password
    patient/                   patient dashboard + profile
    doctor/                    doctor dashboard, availability, profile
    appointments/[id]/call     video consultation
  components/                  UI kit (ui.tsx), navbar, dialogs, cards
  lib/
    api.ts                     fetch wrapper: tokens, refresh on 401, error messages
    auth.tsx                   session context (role from the JWT, profile name)
    format.ts                  clinic-time date/time formatting
    types.ts                   mirrors the backend's response models
```

## Conventions

- **Light mode only.** Palette tokens live in `src/app/globals.css`: teal `brand-*` for identity
  and primary actions, orange `accent-*` reserved for the booking call-to-action. No animations.
- **Auth.** Access/refresh tokens are kept in `localStorage`; `api()` refreshes the access token
  on a 401 and retries once. Pages are gated client-side with `<RequireRole>`; the API enforces
  every rule server-side regardless.
- **Times.** Slot dates/times are clinic wall-clock values and are formatted as-is, never
  converted through the browser's timezone.

### Next.js 16 / Cache Components rules (the build fails otherwise)

`cacheComponents` is on (template default), so pages are prerendered at build time:

- Components using `useSearchParams()` or `useParams()` must sit inside a `<Suspense>` boundary.
- Don't read the URL (`usePathname()` etc.) or the current time (`Date.now()`) **during render**
  in shared layout components — read them in effects, or in a subtree that only mounts on the
  client (see `components/navbar.tsx` and `lib/use-now.ts`).
- Don't let state change while a Suspense boundary is still hydrating: reading `usePathname()`
  in the root navbar while the session loaded caused React hydration error #418 in production
  builds only.
- Page files may only export the page component (and Next's route config), no helpers.
