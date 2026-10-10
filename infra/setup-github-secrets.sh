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
gh workflow run deploy.yml --repo "$REPO" --ref main && echo "deploy triggered: gh run watch --repo $REPO"
