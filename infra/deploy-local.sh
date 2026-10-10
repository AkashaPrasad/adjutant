#!/usr/bin/env bash
# Deploy production from a workstation (no GitHub Actions needed). Idempotent; safe to re-run.
#
#   infra/deploy-local.sh backend  <sha>   signed deploy to the AWS host, wait for /health == sha
#   infra/deploy-local.sh frontend <sha>   build <sha>'s frontend, ensure Pages project + domain, publish
#   infra/deploy-local.sh all      <sha>   backend, then frontend
#   (<sha> defaults to origin/main after a fetch; it must already be pushed: the host clones from GitHub)
#
# Credentials come from the environment, or from a repo-root .env if present (never committed):
#   backend:  DEPLOY_SIGNING_KEY (base64 PEM Ed25519), MUSE_API_KEY, ADJUTANT_SIGNING_KEY
#             (or ADJUTANT_SIGNING_KEY_FILE pointing at a file that holds it)
#   frontend: CLOUDFLARE_API_TOKEN, CLOUDFLARE_ACCOUNT_ID
# Optional overrides: API_DOMAIN, FRONTEND_DOMAIN, PAGES_PROJECT, DNS_ZONE, ALLOWED_ORIGINS.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
if [ -f "$ROOT/.env" ]; then set -a; . "$ROOT/.env"; set +a; fi

TARGET="${1:-}"
case "$TARGET" in backend|frontend|all) ;; *) echo "usage: $0 backend|frontend|all [sha]" >&2; exit 2;; esac

export API_DOMAIN="${API_DOMAIN:-api.adjutant.spacesdrive.cc}"
export FRONTEND_DOMAIN="${FRONTEND_DOMAIN:-adjutant.spacesdrive.cc}"
export PAGES_PROJECT="${PAGES_PROJECT:-adjutant}"
export DNS_ZONE="${DNS_ZONE:-spacesdrive.cc}"
# Pages assigned the project the subdomain adjutant-cxd.pages.dev (adjutant.pages.dev is someone else's).
export PAGES_HOST="${PAGES_HOST:-adjutant-cxd.pages.dev}"
export ALLOWED_ORIGINS="${ALLOWED_ORIGINS:-https://$FRONTEND_DOMAIN,https://$PAGES_HOST,http://localhost:5173}"

git -C "$ROOT" fetch --quiet origin
SHA="$(git -C "$ROOT" rev-parse --verify "${2:-origin/main}^{commit}")"
if ! git -C "$ROOT" branch -r --contains "$SHA" | grep -q .; then
  echo "commit $SHA is not on any origin branch; push it first (the host fetches from GitHub)" >&2
  exit 1
fi

need() { for v in "$@"; do [ -n "${!v:-}" ] || { echo "missing env var $v" >&2; exit 1; }; done; }

deploy_backend() {
  if [ -z "${ADJUTANT_SIGNING_KEY:-}" ] && [ -n "${ADJUTANT_SIGNING_KEY_FILE:-}" ]; then
    ADJUTANT_SIGNING_KEY="$(tr -d '\n' < "$ADJUTANT_SIGNING_KEY_FILE")"
  fi
  export ADJUTANT_SIGNING_KEY
  need DEPLOY_SIGNING_KEY MUSE_API_KEY ADJUTANT_SIGNING_KEY
  echo "== backend: deploying $SHA to https://$API_DOMAIN"
  "$ROOT/infra/deploy-backend.sh" "$SHA"
}

deploy_frontend() {
  need CLOUDFLARE_API_TOKEN CLOUDFLARE_ACCOUNT_ID
  export CLOUDFLARE_API_TOKEN CLOUDFLARE_ACCOUNT_ID
  # Node 22 fetch (wrangler) ignores HTTPS_PROXY unless told; harmless when no proxy is set.
  if [ -n "${HTTPS_PROXY:-${https_proxy:-}}" ]; then
    export NODE_USE_ENV_PROXY=1
    [ -f /root/.ccr/ca-bundle.crt ] && export NODE_EXTRA_CA_CERTS="${NODE_EXTRA_CA_CERTS:-/root/.ccr/ca-bundle.crt}"
  fi
  local work; work="$(mktemp -d)"
  # Build the exact commit from a clean export, so local edits never leak into production.
  git -C "$ROOT" archive "$SHA" frontend | tar -x -C "$work"
  echo "== frontend: building $SHA"
  ( cd "$work/frontend" && npm ci --no-audit --no-fund \
      && VITE_API_BASE="https://$API_DOMAIN" VITE_GIT_SHA="$SHA" VITE_BUILD_TIME="$(date -u +%FT%TZ)" npm run build )
  echo "== frontend: ensuring Pages project $PAGES_PROJECT and domain $FRONTEND_DOMAIN"
  "$ROOT/infra/cloudflare/ensure-pages.sh" "$PAGES_PROJECT" "$FRONTEND_DOMAIN"
  echo "== frontend: publishing"
  ( cd "$work" && npx --yes wrangler@4 pages deploy frontend/dist --project-name "$PAGES_PROJECT" \
      --branch main --commit-hash "$SHA" --commit-dirty=true )
  rm -rf "$work"
  for _ in $(seq 1 30); do
    code=$(curl -sS -o /dev/null -w '%{http_code}' --max-time 15 "https://$FRONTEND_DOMAIN/" 2>/dev/null || true)
    [ "$code" = 200 ] && { echo "frontend live: https://$FRONTEND_DOMAIN (also https://$PAGES_HOST)"; return 0; }
    sleep 10
  done
  echo "warning: https://$FRONTEND_DOMAIN not answering 200 yet (custom domain may still be activating)" >&2
}

case "$TARGET" in
  backend) deploy_backend ;;
  frontend) deploy_frontend ;;
  all) deploy_backend; deploy_frontend ;;
esac
