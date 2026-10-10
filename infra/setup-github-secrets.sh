#!/usr/bin/env bash
# One-time: copy production secrets from the local .env into GitHub Actions secrets,
# then trigger the first production deploy. Safe to re-run (it overwrites with current values).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
REPO="${REPO:-AkashaPrasad/adjutant}"
set -a; . "$ROOT/.env"; set +a
for key in CLOUDFLARE_API_TOKEN CLOUDFLARE_ACCOUNT_ID MUSE_API_KEY ADJUTANT_SIGNING_KEY DEPLOY_SIGNING_KEY; do
  [ -n "${!key:-}" ] || { echo "missing $key in .env" >&2; exit 1; }
  printf '%s' "${!key}" | gh secret set "$key" --repo "$REPO"
  echo "secret set: $key"
done
# Non-secret settings (deploy.yml has the same defaults), then enable the deploy jobs.
gh variable set API_DOMAIN --repo "$REPO" --body "api.adjutant.spacesdrive.cc"
gh variable set FRONTEND_DOMAIN --repo "$REPO" --body "adjutant.spacesdrive.cc"
gh variable set PAGES_PROJECT --repo "$REPO" --body "adjutant"
gh variable set PAGES_HOST --repo "$REPO" --body "adjutant-cxd.pages.dev"
gh variable set DNS_ZONE --repo "$REPO" --body "spacesdrive.cc"
gh variable set BACKEND_IP --repo "$REPO" --body "13.232.187.107"
gh variable set DEPLOY_ENABLED --repo "$REPO" --body "true"
echo "variables set; DEPLOY_ENABLED=true"
gh workflow run deploy.yml --repo "$REPO" --ref main && echo "deploy triggered: gh run watch --repo $REPO"
