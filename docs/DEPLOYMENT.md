# Deployment

| Surface | Where | URL |
| --- | --- | --- |
| Frontend | Cloudflare Pages project `adjutant` (Pages host `adjutant-cxd.pages.dev`) | https://adjutant.spacesdrive.cc |
| Backend | AWS Lightsail instance `adjutant-gate` (ap-south-1, Ubuntu 24.04, static IP `adjutant-gate-ip` = 13.232.187.107) | https://api.adjutant.spacesdrive.cc |
| DNS | Cloudflare zone `spacesdrive.cc` | `api.adjutant` A (DNS only), `adjutant` CNAME to `adjutant-cxd.pages.dev` (proxied) |

## Deploying today: `infra/deploy-local.sh`

GitHub Actions secrets have not been set yet (see "Enabling Actions deploys" below), so production is deployed from a workstation:

```bash
infra/deploy-local.sh backend  <sha>   # signed deploy to AWS, waits until /health reports <sha>
infra/deploy-local.sh frontend <sha>   # builds <sha>'s frontend, ensures Pages project + domain, publishes
infra/deploy-local.sh all      <sha>   # both; <sha> defaults to origin/main
```

- `<sha>` must already be pushed: the host fetches it from GitHub. The frontend is built from a clean `git archive` of `<sha>`, so uncommitted local edits never ship.
- Credentials come from exported env vars, or from a repo-root `.env` (gitignored, never commit it): `DEPLOY_SIGNING_KEY`, `MUSE_API_KEY`, `ADJUTANT_SIGNING_KEY` (or `ADJUTANT_SIGNING_KEY_FILE`) for the backend; `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID` for the frontend.
- The script is idempotent. Behind an egress proxy it sets `NODE_USE_ENV_PROXY=1` so wrangler honours `HTTPS_PROXY`.
- Verify: `curl https://api.adjutant.spacesdrive.cc/health` (`commit` equals `<sha>`, `llm_configured` is true) and the commit chips in the console header.

### `ADJUTANT_SIGNING_KEY`

A 32-byte hex secret (`openssl rand -hex 32`) that the backend uses to sign audit packets (without it the host falls back to an insecure dev key). It is generated once, kept outside the repo (in `.env`, or a file passed via `ADJUTANT_SIGNING_KEY_FILE`), and delivered to the host inside each signed deploy. Reuse the same value on every deploy: changing it invalidates verification of earlier audit packets. When Actions deploys are enabled, store the same value as the `ADJUTANT_SIGNING_KEY` secret.

## Pipeline (GitHub Actions)

`push to main` → `.github/workflows/deploy.yml`:

1. `ci` runs `.github/workflows/ci.yml` (ruff + pytest, typecheck + build). It always runs; CI also runs on PRs and other branches.
2. `dns` ensures the `api.adjutant` A record points at the host (`infra/cloudflare/ensure-dns.sh`).
3. `backend` runs `infra/deploy-backend.sh <sha>`: it signs `{sha, env}` with the Ed25519 key in `DEPLOY_SIGNING_KEY` and POSTs it to `https://api.adjutant.spacesdrive.cc/_deploy`. The host verifies the signature against `infra/aws/deploy-signing.pub`, writes the env to `/etc/adjutant/env`, checks out the commit, runs `uv sync --frozen`, restarts `adjutant-gate`, and the job waits until `/health` reports that commit.
4. `frontend` builds with `VITE_API_BASE=https://api.adjutant.spacesdrive.cc`, ensures the Pages project and custom domain (`infra/cloudflare/ensure-pages.sh`), then runs `wrangler pages deploy`.

Steps 2-4 run only when the repository variable `DEPLOY_ENABLED` is `true`. Without it they are skipped and the workflow stays green.

### Enabling Actions deploys

From a machine with a working `gh` login and the secrets in `.env`, run `infra/setup-github-secrets.sh`. It sets the secrets `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`, `MUSE_API_KEY`, `ADJUTANT_SIGNING_KEY`, `DEPLOY_SIGNING_KEY`, the variables (`API_DOMAIN`, `FRONTEND_DOMAIN`, `PAGES_PROJECT`, `PAGES_HOST`, `DNS_ZONE`, `BACKEND_IP`; `deploy.yml` has the same defaults) and `DEPLOY_ENABLED=true`, then triggers a deploy. To rotate a key, edit `.env` and rerun it.

(The agent sandbox that built this could not do this step: its egress proxy blocks the GitHub Actions secrets/variables API with HTTP 403.)

Backend runtime env is delivered by each deploy. To add a backend env var, add it to the `env` object in `infra/deploy-backend.sh` and pass it from a secret in `deploy.yml`.

## Host

No SSH. The firewall allows 80 and 443 only. Caddy terminates TLS and proxies `/_deploy*` to the hook (127.0.0.1:9000) and everything else to uvicorn (127.0.0.1:8000, 1 worker). SQLite lives at `/var/lib/adjutant/data/adjutant.db`.
Deploy state: `GET https://api.adjutant.spacesdrive.cc/_deploy/status`.
`infra/aws/host-bootstrap.sh` is the user-data (it re-execs under bash if Lightsail runs it with `/bin/sh`). Caddy comes from Ubuntu's `universe` archive because the Cloudsmith Caddy apt repo answers 402. For a shell, use the Lightsail browser console, or reprovision with `infra/aws/provision.sh` (idempotent).
