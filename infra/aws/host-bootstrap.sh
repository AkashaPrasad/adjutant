#!/usr/bin/env bash
# Adjutant Gate backend host bootstrap (Ubuntu 24.04, arm64). Runs once as EC2 user-data.
# Installs Caddy (automatic HTTPS), uv, the API service and a signed deploy hook.
# Contains no secrets. The host trusts deploy requests signed by the Ed25519 key whose public
# half is embedded below (infra/aws/deploy-signing.pub). Application secrets arrive over HTTPS
# inside each signed deploy from GitHub Actions.
set -euxo pipefail
exec > >(tee -a /var/log/adjutant-bootstrap.log) 2>&1

API_DOMAIN="${API_DOMAIN:-api.adjutant.spacesdrive.cc}"
REPO_URL="${REPO_URL:-https://github.com/AkashaPrasad/adjutant.git}"
export DEBIAN_FRONTEND=noninteractive

apt-get update -y
apt-get install -y git curl ca-certificates debian-keyring debian-archive-keyring apt-transport-https python3 python3-cryptography sqlite3 gnupg
curl -1sLf https://dl.cloudsmith.io/public/caddy/stable/gpg.key | gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
curl -1sLf https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt > /etc/apt/sources.list.d/caddy-stable.list
apt-get update -y && apt-get install -y caddy
curl -LsSf https://astral.sh/uv/install.sh | env UV_INSTALL_DIR=/usr/local/bin UV_NO_MODIFY_PATH=1 sh

id adjutant >/dev/null 2>&1 || useradd --system --create-home --home-dir /var/lib/adjutant --shell /usr/sbin/nologin adjutant
install -d -o adjutant -g adjutant -m 750 /var/lib/adjutant/data /opt/adjutant
install -d -m 700 /etc/adjutant
umask 077
cat > /etc/adjutant/deploy-signing.pub <<'PUB'
-----BEGIN PUBLIC KEY-----
MCowBQYDK2VwAyEA0+63EW3qFeVKfXzQ4nbU0hMCrksGO0PBJkl0gWdWeR8=
-----END PUBLIC KEY-----
PUB
touch /etc/adjutant/env /etc/adjutant/runtime.env
umask 022

# --- deploy script: check out an exact commit, sync deps, restart, health-check ---
cat > /usr/local/bin/adjutant-deploy <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
SHA="${1:?commit sha required}"
REPO_URL="https://github.com/AkashaPrasad/adjutant.git"
STATUS=/var/lib/adjutant/deploy-status.json
exec 9>/var/lock/adjutant-deploy.lock; flock 9
status() { echo "{\"sha\":\"$SHA\",\"state\":\"$1\",\"at\":\"$(date -u +%FT%TZ)\"}" > "$STATUS"; }
status deploying
cd /opt/adjutant
if [ ! -d .git ]; then sudo -u adjutant git clone --quiet "$REPO_URL" .; fi
sudo -u adjutant git fetch --quiet origin
sudo -u adjutant git checkout --quiet --force "$SHA"
cd backend
sudo -u adjutant env UV_CACHE_DIR=/var/lib/adjutant/.cache/uv uv sync --frozen --no-dev --quiet
printf 'GIT_SHA=%s\nDEPLOYED_AT=%s\nAPP_ENV=production\nADJUTANT_DB_PATH=/var/lib/adjutant/data/adjutant.db\n' \
  "$SHA" "$(date -u +%FT%TZ)" > /etc/adjutant/runtime.env
systemctl restart adjutant-gate
for _ in $(seq 1 45); do
  if curl -fsS http://127.0.0.1:8000/health | grep -q "$SHA"; then status live; exit 0; fi
  sleep 2
done
status failed
journalctl -u adjutant-gate -n 80 --no-pager
exit 1
EOF
chmod 755 /usr/local/bin/adjutant-deploy

# --- signed deploy hook (Python stdlib only) ---
cat > /usr/local/bin/adjutant-deploy-hook <<'EOF'
#!/usr/bin/env python3
"""Signed deploy hook for the Adjutant Gate host.

POST /_deploy   body {"sha": "<40 hex>", "env": {"KEY": "value", ...}}
  X-Adjutant-Timestamp: unix seconds (must be within 5 minutes)
  X-Adjutant-Signature: base64 Ed25519 signature over f"{timestamp}.{body}"
GET  /_deploy/status   last deploy state (no secrets)
"""
import base64, json, os, re, subprocess, time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

from cryptography.exceptions import InvalidSignature
from cryptography.hazmat.primitives.serialization import load_pem_public_key

PUBLIC_KEY = load_pem_public_key(open("/etc/adjutant/deploy-signing.pub", "rb").read())
KEY_RE = re.compile(r"^[A-Z][A-Z0-9_]{0,63}$")
SHA_RE = re.compile(r"^[0-9a-f]{40}$")


class Handler(BaseHTTPRequestHandler):
    def _send(self, code, obj):
        body = json.dumps(obj).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        if self.path.rstrip("/") == "/_deploy/status":
            try:
                return self._send(200, json.load(open("/var/lib/adjutant/deploy-status.json")))
            except Exception:
                return self._send(200, {"state": "unknown"})
        self._send(404, {"error": "not found"})

    def do_POST(self):
        if self.path.rstrip("/") != "/_deploy":
            return self._send(404, {"error": "not found"})
        length = int(self.headers.get("Content-Length") or 0)
        if length <= 0 or length > 65536:
            return self._send(400, {"error": "bad length"})
        body = self.rfile.read(length)
        ts = self.headers.get("X-Adjutant-Timestamp", "")
        sig = self.headers.get("X-Adjutant-Signature", "")
        if not ts.isdigit() or abs(time.time() - int(ts)) > 300:
            return self._send(401, {"error": "stale or missing timestamp"})
        try:
            PUBLIC_KEY.verify(base64.b64decode(sig), ts.encode() + b"." + body)
        except (InvalidSignature, ValueError):
            return self._send(401, {"error": "bad signature"})
        data = json.loads(body)
        sha = str(data.get("sha", ""))
        if not SHA_RE.match(sha):
            return self._send(400, {"error": "bad sha"})
        lines = []
        for key, value in (data.get("env") or {}).items():
            value = str(value)
            if not KEY_RE.match(key) or "\n" in value or "\r" in value:
                return self._send(400, {"error": f"bad env var {key}"})
            if value:
                lines.append(f"{key}={value}")
        if lines:
            old = os.umask(0o077)
            with open("/etc/adjutant/env.tmp", "w") as fh:
                fh.write("\n".join(lines) + "\n")
            os.replace("/etc/adjutant/env.tmp", "/etc/adjutant/env")
            os.umask(old)
        subprocess.Popen(["/usr/local/bin/adjutant-deploy", sha], start_new_session=True,
                         stdout=open("/var/log/adjutant-deploy.log", "a"), stderr=subprocess.STDOUT)
        self._send(202, {"accepted": sha})

    def log_message(self, *args):
        pass


ThreadingHTTPServer(("127.0.0.1", 9000), Handler).serve_forever()
EOF
chmod 755 /usr/local/bin/adjutant-deploy-hook

cat > /etc/systemd/system/adjutant-deploy-hook.service <<'EOF'
[Unit]
Description=Adjutant Gate signed deploy hook
After=network-online.target

[Service]
ExecStart=/usr/bin/python3 /usr/local/bin/adjutant-deploy-hook
Restart=always

[Install]
WantedBy=multi-user.target
EOF

cat > /etc/systemd/system/adjutant-gate.service <<'EOF'
[Unit]
Description=Adjutant Gate API
After=network-online.target

[Service]
User=adjutant
Group=adjutant
WorkingDirectory=/opt/adjutant/backend
EnvironmentFile=-/etc/adjutant/env
EnvironmentFile=-/etc/adjutant/runtime.env
Environment=UV_CACHE_DIR=/var/lib/adjutant/.cache/uv
ExecStart=/usr/local/bin/uv run --frozen --no-dev uvicorn app.main:app --host 127.0.0.1 --port 8000 --workers 1 --proxy-headers
Restart=always
RestartSec=3
NoNewPrivileges=true

[Install]
WantedBy=multi-user.target
EOF

cat > /etc/caddy/Caddyfile <<EOF
$API_DOMAIN {
	encode zstd gzip
	handle /_deploy* {
		reverse_proxy 127.0.0.1:9000
	}
	handle {
		reverse_proxy 127.0.0.1:8000
	}
}
EOF

systemctl daemon-reload
systemctl enable --now adjutant-deploy-hook
systemctl enable adjutant-gate
systemctl restart caddy

# First deploy of current main (if the repo has code yet) so the API is up before CI's first run.
HEAD_SHA="$(git ls-remote "$REPO_URL" refs/heads/main | cut -f1 || true)"
if [ -n "$HEAD_SHA" ]; then /usr/local/bin/adjutant-deploy "$HEAD_SHA" || true; fi
echo "bootstrap complete"
