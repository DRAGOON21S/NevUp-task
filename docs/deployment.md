# Deployment

Railway is the primary hosting target.

Use:

- `railway.api.toml` for the API service.
- `railway.worker.toml` for the analytics worker service.
- `docs/railway.md` for the exact Railway setup steps.

The older `render.yaml` remains available as a fallback.

`render.yaml` defines:

- `nevup-api`: web service running migrations, idempotent seed, then the API.
- `nevup-analytics-worker`: background worker consuming Redis Stream events.
- `nevup-postgres`: managed PostgreSQL.
- `nevup-redis`: managed Key Value instance used as Redis.

For Railway, create separate API and worker services from the same repo and set each service's config file path:

- API config: `/railway.api.toml`
- Worker config: `/railway.worker.toml`

For Render fallback, deploy from the `draft1` folder or keep `render.yaml` as the Blueprint file for this app.

After deploy, verify:

```powershell
Invoke-RestMethod -Uri https://YOUR-API-URL/health | ConvertTo-Json -Depth 5
```

Then run a small authenticated smoke against the live URL:

```powershell
$env:DEPLOY_BASE_URL='https://YOUR-API-URL'
npm.cmd run smoke:deploy
```

The deployment smoke checks health, seed reads, metrics, profile, and an idempotent trade write.
It prints the synthetic trade/session IDs it created.

Run a small load smoke against the live URL:

```powershell
$env:LOAD_BASE_URL='https://YOUR-API-URL'
$env:LOAD_RPS='2'; $env:LOAD_DURATION_SECONDS='1'; $env:LOAD_CONCURRENCY='2'; npm.cmd run loadtest:trades
```

Use `npm.cmd run loadtest:cleanup` locally against the same deployed `DATABASE_URL` after any smoke/load test that writes synthetic trades.

Expected Railway production env vars:

- `NODE_ENV=production`
- `PORT=4010`
- `POOL_MAX=50`
- `REQUEST_LOG_SAMPLE_RATE=0.01`
- `SEED_CSV_PATH=data/nevup_seed_dataset.csv`
- `JWT_SECRET`
- `DATABASE_URL`
- `REDIS_URL`
