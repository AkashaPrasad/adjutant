#!/usr/bin/env bash
# Create or update one DNS record in the Cloudflare zone (idempotent).
# Usage: ensure-dns.sh <fqdn> <A|CNAME> <content> <proxied:true|false>
# Env: CLOUDFLARE_API_TOKEN, DNS_ZONE (e.g. spacesdrive.cc)
set -euo pipefail
NAME="$1"; TYPE="$2"; CONTENT="$3"; PROXIED="$4"
API=https://api.cloudflare.com/client/v4
auth=(-H "Authorization: Bearer $CLOUDFLARE_API_TOKEN" -H "Content-Type: application/json")

ZONE_ID=$(curl -fsS "${auth[@]}" "$API/zones?name=$DNS_ZONE" | jq -r '.result[0].id // empty')
[ -n "$ZONE_ID" ] || { echo "zone $DNS_ZONE not visible to this token" >&2; exit 1; }

BODY=$(jq -cn --arg t "$TYPE" --arg n "$NAME" --arg c "$CONTENT" --argjson p "$PROXIED" \
  '{type:$t, name:$n, content:$c, proxied:$p, ttl:1, comment:"managed by AkashaPrasad/adjutant CI"}')
EXISTING=$(curl -fsS "${auth[@]}" "$API/zones/$ZONE_ID/dns_records?name=$NAME" | jq -r '.result[0] // empty')

if [ -z "$EXISTING" ]; then
  curl -fsS -X POST "${auth[@]}" "$API/zones/$ZONE_ID/dns_records" --data "$BODY" | jq -c '{success, errors}'
  echo "created $TYPE $NAME -> $CONTENT"
elif [ "$(jq -r '.type + "|" + .content + "|" + (.proxied|tostring)' <<<"$EXISTING")" = "$TYPE|$CONTENT|$PROXIED" ]; then
  echo "unchanged $TYPE $NAME -> $CONTENT"
else
  ID=$(jq -r .id <<<"$EXISTING")
  curl -fsS -X PUT "${auth[@]}" "$API/zones/$ZONE_ID/dns_records/$ID" --data "$BODY" | jq -c '{success, errors}'
  echo "updated $TYPE $NAME -> $CONTENT"
fi
