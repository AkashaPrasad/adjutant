#!/usr/bin/env bash
# Ensure the Cloudflare Pages project exists and serves the custom domain (idempotent).
# Usage: ensure-pages.sh <project> <custom-domain>
# Env: CLOUDFLARE_API_TOKEN, CLOUDFLARE_ACCOUNT_ID, DNS_ZONE
set -euo pipefail
PROJECT="$1"; DOMAIN="$2"
API="https://api.cloudflare.com/client/v4/accounts/$CLOUDFLARE_ACCOUNT_ID/pages/projects"
auth=(-H "Authorization: Bearer $CLOUDFLARE_API_TOKEN" -H "Content-Type: application/json")

if ! curl -fsS "${auth[@]}" "$API/$PROJECT" >/dev/null 2>&1; then
  curl -fsS -X POST "${auth[@]}" "$API" \
    --data "$(jq -cn --arg n "$PROJECT" '{name:$n, production_branch:"main"}')" | jq -c '{success, errors}'
fi
SUBDOMAIN=$(curl -fsS "${auth[@]}" "$API/$PROJECT" | jq -r .result.subdomain)
echo "pages subdomain: $SUBDOMAIN"

if ! curl -fsS "${auth[@]}" "$API/$PROJECT/domains/$DOMAIN" >/dev/null 2>&1; then
  curl -fsS -X POST "${auth[@]}" "$API/$PROJECT/domains" \
    --data "$(jq -cn --arg n "$DOMAIN" '{name:$n}')" | jq -c '{success, errors}'
fi
"$(dirname "$0")/ensure-dns.sh" "$DOMAIN" CNAME "$SUBDOMAIN" true
