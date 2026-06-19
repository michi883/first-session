#!/usr/bin/env bash
# Deploy the First Session SPA to Firebase Hosting.
#
# firebase.json has a predeploy hook that runs the Vite build, so this just
# invokes the deploy. Requires the Firebase CLI, authenticated against the
# first-session-ux project (firebase login).
set -euo pipefail

PROJECT="${PROJECT:-first-session-ux}"

# Run from the repo root regardless of where the script is invoked.
cd "$(dirname "$0")/.."

echo "==> Deploying to Firebase Hosting (project=${PROJECT}) ..."
firebase deploy --only hosting --project "${PROJECT}"
echo "==> Done. Hosting URL printed above."
