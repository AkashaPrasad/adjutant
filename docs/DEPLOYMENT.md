# Deployment

| Surface | Where | URL |
| --- | --- | --- |
| Frontend | Cloudflare Pages project `adjutant` | https://adjutant.spacesdrive.cc |
| Backend | AWS Lightsail instance `adjutant-gate` (ap-south-1, Ubuntu 24.04, static IP `adjutant-gate-ip`) | https://api.adjutant.spacesdrive.cc |
| DNS | Cloudflare zone `spacesdrive.cc` | `api.adjutant` A (DNS only), `adjutant` CNAME to Pages (proxied) |

## Pipeline

`push to main` → `.github/workflows/deploy.yml`:

1. `ci` runs `.github/workflows/ci.yml` (ruff + pytest, typecheck + build).
2. `dns` ensures the `api.adjutant` A record points at the host (`infra/cloudflare/ensure-dns.sh`).
3. `backend` runs `infra/deploy-backend.sh <sha>`: it signs `{sha, env}` with the Ed25519 key in the `DEPLOY_SIGNING_KEY` secret and POSTs it to `https://api.adjutant.spacesdrive.cc/_deploy`. The host verifies the signature against `infra/aws/deploy-signing.pub`, writes the env to `/etc/adjutant/env`, checks out the commit, runs `uv sync --frozen`, restarts `adjutant-gate`, and the job waits until `/health` reports that commit.
4. `frontend` builds with `VITE_API_BASE=https://api.adjutant.spacesdrive.cc`, ensures the Pages project and custom domain (`infra/cloudflare/ensure-pages.sh`), then runs `wrangler pages deploy`.

Pull requests and non-main branches run CI only.

## Secrets and variables

GitHub Actions secrets: `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`, `MUSE_API_KEY`, `ADJUTANT_SIGNING_KEY`, `DEPLOY_SIGNING_KEY`.
GitHub Actions variables: `BACKEND_IP`, `API_DOMAIN`, `FRONTEND_DOMAIN`, `PAGES_PROJECT`, `DNS_ZONE`.
`infra/setup-github-secrets.sh` copies the secrets from the local `.env` and triggers a deploy. To rotate a key, edit `.env`, rerun the script.

Backend runtime env is delivered by each deploy. To add a new backend env var, add it to the `env` object in `infra/deploy-backend.sh` and pass it from a secret in `deploy.yml`.

## Host

No SSH. The firewall allows 80 and 443 only. Caddy terminates TLS and proxies `/_deploy*` to the hook (127.0.0.1:9000) and everything else to uvicorn (127.0.0.1:8000, 1 worker). SQLite lives at `/var/lib/adjutant/data/adjutant.db`.
Deploy state: `GET https://api.adjutant.spacesdrive.cc/_deploy/status`.
For a shell, use the Lightsail browser console, or reprovision with `infra/aws/provision.sh` (idempotent).
