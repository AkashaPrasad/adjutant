# Notes for coding agents

- Product: Adjutant Gate (see README.md). Backend is FastAPI in `backend/`, frontend is Vite + React in `frontend/`.
- **Shipping = `git push origin main`.** GitHub Actions tests, then deploys the backend to AWS and the frontend to Cloudflare Pages. Watch with `gh run watch`. Confirm with `curl https://api.adjutant.spacesdrive.cc/health` (the `commit` field equals the pushed SHA) and the commit chips in the console header at https://adjutant.spacesdrive.cc.
- Before pushing: `cd backend && uv run ruff check . && uv run pytest -q` and `cd frontend && npm run typecheck && npm run build`. A red CI blocks the deploy.
- Backend deps: edit `backend/pyproject.toml`, run `uv lock`, commit `uv.lock` (the host installs with `--frozen`). Frontend deps: commit `package-lock.json`.
- LLM: only Meta Muse Spark 1.3 Contributor (`muse-spark-1.3-contributor`, OpenAI-compatible at `https://api.meta.ai/v1`) via `backend/app/llm.py`.
- Secrets live in the local gitignored `.env` and in GitHub Actions secrets. Never commit `.env`. New backend env vars: see docs/DEPLOYMENT.md.
- Commits: no AI co-author trailers.
