#!/usr/bin/env bash
# Trigger a signed backend deploy of one commit and wait until /health reports it.
# Usage: deploy-backend.sh <sha>
# Env: API_DOMAIN, DEPLOY_SIGNING_KEY (base64 PEM, Ed25519), MUSE_API_KEY, ADJUTANT_SIGNING_KEY, ALLOWED_ORIGINS
set -euo pipefail
SHA="$1"
BASE="https://$API_DOMAIN"
WORK=$(mktemp -d); trap 'rm -rf "$WORK"' EXIT
printf '%s' "$DEPLOY_SIGNING_KEY" | base64 -d > "$WORK/key.pem"

echo "waiting for $BASE to serve HTTPS (first boot can take a few minutes)"
for i in $(seq 1 60); do
  curl -fsS --max-time 10 "$BASE/_deploy/status" >/dev/null 2>&1 && break
  [ "$i" = 60 ] && { echo "host not reachable over HTTPS" >&2; exit 1; }
  sleep 10
done

BODY=$(jq -cn --arg sha "$SHA" \
  --arg muse "${MUSE_API_KEY:-}" --arg sign "${ADJUTANT_SIGNING_KEY:-}" --arg origins "${ALLOWED_ORIGINS:-}" \
  '{sha:$sha, env:{MUSE_API_KEY:$muse, MUSE_BASE_URL:"https://api.meta.ai/v1", MUSE_MODEL:"muse-spark-1.3-contributor",
                   ADJUTANT_SIGNING_KEY:$sign, ALLOWED_ORIGINS:$origins}}')
TS=$(date +%s)
printf '%s.%s' "$TS" "$BODY" > "$WORK/msg"
SIG=$(openssl pkeyutl -sign -inkey "$WORK/key.pem" -rawin -in "$WORK/msg" | base64 | tr -d '\n')

curl -fsS -X POST "$BASE/_deploy" -H "Content-Type: application/json" \
  -H "X-Adjutant-Timestamp: $TS" -H "X-Adjutant-Signature: $SIG" --data-binary "$BODY"
echo

for _ in $(seq 1 60); do
  if curl -fsS --max-time 10 "$BASE/health" 2>/dev/null | jq -e --arg s "$SHA" '.commit == $s' >/dev/null; then
    echo "backend live at $SHA"; curl -fsS "$BASE/health"; echo; exit 0
  fi
  sleep 5
done
echo "backend did not report $SHA in time; last status:" >&2
curl -fsS "$BASE/_deploy/status" >&2 || true
exit 1
