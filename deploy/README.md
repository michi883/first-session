# Deployment

First Session is a **static SPA** (one Vite build, no backend), so it deploys to
**Firebase Hosting** — a global CDN serving `apps/web/dist` — on the GCP project
**`first-session-ux`**.

| Target               | What runs                            | Config                         |
| -------------------- | ------------------------------------ | ------------------------------ |
| **Firebase Hosting** | Static CDN serving `apps/web/dist`   | `firebase.json`, `.firebaserc` |

> The app is fully static, so a CDN is all it needs. There is intentionally no
> container / Cloud Run path: it would only run an nginx server to serve the same
> static files, adding cold starts and an image to maintain for no functional
> gain. If a backend (API, SSR, auth) is ever added, revisit a container target
> then.

## Prerequisites

```bash
# Once per machine:
npm install                       # repo root — pipeline deps
npm run web:install               # apps/web deps

# Auth:
firebase login                    # for Firebase Hosting
```

The Firebase CLI (`firebase`) must be installed.

## Firebase Hosting

```bash
npm run deploy:hosting
# or: bash deploy/deploy-firebase.sh
```

`firebase.json` runs `npm --prefix apps/web run build` as a `predeploy` hook,
then publishes `apps/web/dist` with an SPA rewrite (`** → /index.html`) and
long-cache headers on hashed `/assets/**`. Live at
<https://first-session-ux.web.app>.

## Notes

- **No secrets ship.** The data pipeline's `GEMINI_API_KEY` lives in `.env`
  (gitignored). The app itself reads only the committed
  `apps/web/src/data/accessPaths.json`.
- Regenerate that fixture from the pipeline outputs before deploying if the
  data changed: `npm run fixture`.
