#!/usr/bin/env bash
# One-time IAM setup for `gcloud run deploy --source` (Cloud Build).
#
# Source-based Cloud Run deploys build the image with Cloud Build, which runs as
# the project's Compute Engine default service account. On a fresh project that
# account has no roles, so the build cannot read the uploaded source, push to
# Artifact Registry, or write logs -- producing:
#
#   PERMISSION_DENIED: Build failed because the default service account is
#   missing required IAM permissions.
#
# Granting roles/cloudbuild.builds.builder fixes all three at once. Run this
# once per project. Requires owner or resourcemanager.projectIamAdmin.
set -euo pipefail

PROJECT="${PROJECT:-first-session-ux}"

NUMBER="$(gcloud projects describe "${PROJECT}" --format='value(projectNumber)')"
SA="${NUMBER}-compute@developer.gserviceaccount.com"

echo "==> Granting roles/cloudbuild.builds.builder to ${SA} on ${PROJECT} ..."
gcloud projects add-iam-policy-binding "${PROJECT}" \
  --member="serviceAccount:${SA}" \
  --role="roles/cloudbuild.builds.builder" \
  --condition=None

echo "==> Done. You can now run: npm run deploy:cloudrun"
