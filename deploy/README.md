# Deployment

First Session is a **static SPA** (one Vite build, no backend). The same
`apps/web/dist` artifact ships to two independent targets on the GCP project
**`first-session-ux`**:

| Target               | What runs                                  | Config                                      |
| -------------------- | ------------------------------------------ | ------------------------------------------- |
| **Firebase Hosting** | Static CDN serving `apps/web/dist`         | `firebase.json`, `.firebaserc`              |
| **Cloud Run**        | nginx container serving the same `dist`    | `Dockerfile`, `deploy/nginx/*.template`     |

Both are wired to project `first-session-ux`. Pick either (or run both).

## Prerequisites

```bash
# Once per machine:
npm install                       # repo root — pipeline deps
npm run web:install               # apps/web deps

# Auth (one of these depending on target):
firebase login                    # for Firebase Hosting
gcloud auth login                 # for Cloud Run
gcloud config set project first-session-ux
```

The Firebase CLI (`firebase`) and Cloud SDK (`gcloud`) must be installed.

## Firebase Hosting

```bash
npm run deploy:hosting
# or: bash deploy/deploy-firebase.sh
```

`firebase.json` runs `npm --prefix apps/web run build` as a `predeploy` hook,
then publishes `apps/web/dist` with an SPA rewrite (`** → /index.html`) and
long-cache headers on hashed `/assets/**`.

## Cloud Run

### First-time IAM setup (once per project)

Source-based deploys build with Cloud Build, which runs as the project's
**Compute Engine default service account**. On a fresh project that account has
no roles, so the build fails with `PERMISSION_DENIED: ... the default service
account is missing required IAM permissions`. Grant it the Cloud Build builder
role once (requires owner / project IAM admin):

```bash
bash deploy/setup-cloudrun-iam.sh
# equivalently:
#   PROJECT_NUMBER=$(gcloud projects describe first-session-ux --format='value(projectNumber)')
#   gcloud projects add-iam-policy-binding first-session-ux \
#     --member="serviceAccount:${PROJECT_NUMBER}-compute@developer.gserviceaccount.com" \
#     --role="roles/cloudbuild.builds.builder" --condition=None
```

### Deploy

```bash
npm run deploy:cloudrun
# or: bash deploy/deploy-cloudrun.sh
```

This uses `gcloud run deploy --source .`, which builds the root `Dockerfile`
with Cloud Build (multi-stage: Node builds the app → nginx serves it), pushes
the image to Artifact Registry, and deploys the service
`first-session-web` to `us-central1`, publicly reachable.

Override defaults with env vars:

```bash
REGION=us-east1 SERVICE=first-session-web bash deploy/deploy-cloudrun.sh
```

### Build / run the container locally

```bash
docker build -t first-session-web .
docker run --rm -p 8080:8080 first-session-web
# open http://localhost:8080
```

nginx listens on `$PORT` (default `8080`); Cloud Run injects `PORT` at runtime
and the official nginx image substitutes it via its envsubst entrypoint.

## Notes

- **No secrets ship to either target.** The data pipeline's `GEMINI_API_KEY`
  lives in `.env` (gitignored, and excluded by `.dockerignore`). The app itself
  reads only the committed `apps/web/src/data/accessPaths.json`.
- Regenerate that fixture from the pipeline outputs before deploying if the
  data changed: `npm run fixture`.
