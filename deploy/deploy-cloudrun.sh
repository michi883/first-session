#!/usr/bin/env bash
# Deploy the First Session SPA to Cloud Run as a container (nginx serving the
# Vite build). Uses the root Dockerfile via Cloud Build -- no local Docker needed.
#
# Requires the gcloud CLI authenticated against the project (gcloud auth login)
# with billing enabled. Override defaults with env vars, e.g.:
#   REGION=us-east1 SERVICE=first-session-web bash deploy/deploy-cloudrun.sh
set -euo pipefail

PROJECT="${PROJECT:-first-session-ux}"
REGION="${REGION:-us-central1}"
SERVICE="${SERVICE:-first-session-web}"

# Run from the repo root so the build context includes apps/web + the Dockerfile.
cd "$(dirname "$0")/.."

echo "==> Ensuring required APIs are enabled on ${PROJECT} ..."
gcloud services enable \
  run.googleapis.com \
  cloudbuild.googleapis.com \
  artifactregistry.googleapis.com \
  --project "${PROJECT}"

echo "==> Deploying ${SERVICE} to Cloud Run (project=${PROJECT} region=${REGION}) ..."
gcloud run deploy "${SERVICE}" \
  --project "${PROJECT}" \
  --region "${REGION}" \
  --source . \
  --port 8080 \
  --allow-unauthenticated

echo "==> Done. Service URL printed above."
