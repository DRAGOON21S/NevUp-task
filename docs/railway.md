# Railway Deployment

Railway is now the intended hosting target.

This repo supports two Railway services from the same `draft1` codebase:

- API service
- analytics worker service

Railway config-as-code is single-service by default, so this project uses two explicit config files:

- `railway.api.toml`
- `railway.worker.toml`

In Railway, set each service's config file path explicitly.

## Services To Create

Create a Railway project with:

- PostgreSQL database service
- Redis database service
- API service from this repo
- Worker service from this repo

Use `draft1` as the root directory for both code services.

## API Service

Config file:

```text
/railway.api.toml
```

Build:

```text
Dockerfile
```

Start command from config:

```text
npm run start:railway
```

This runs migration, idempotent seed, then starts the API.

Healthcheck:

```text
/health
```

Required variables:

```text
NODE_ENV=production
PORT=4010
POOL_MAX=50
REQUEST_LOG_SAMPLE_RATE=0.01
SEED_CSV_PATH=data/nevup_seed_dataset.csv
JWT_SECRET=97791d4db2aa5f689c3cc39356ce35762f0a73aa70923039d8ef72a2840a1b02
DATABASE_URL=${{Postgres.DATABASE_URL}}
REDIS_URL=${{Redis.REDIS_URL}}
```

The exact `Postgres` and `Redis` service names in reference variables must match the names you use in Railway.

## Worker Service

Config file:

```text
/railway.worker.toml
```

Start command from config:

```text
npm run worker:railway
```

Required variables:

```text
NODE_ENV=production
POOL_MAX=20
WORKER_BATCH_SIZE=50
JWT_SECRET=97791d4db2aa5f689c3cc39356ce35762f0a73aa70923039d8ef72a2840a1b02
DATABASE_URL=${{Postgres.DATABASE_URL}}
REDIS_URL=${{Redis.REDIS_URL}}
```

## Verify Deployment

After Railway assigns the API public domain:

```powershell
$env:DEPLOY_BASE_URL='https://YOUR-RAILWAY-API-DOMAIN'
npm.cmd run smoke:deploy
```

Then run a small write smoke:

```powershell
$env:LOAD_BASE_URL='https://YOUR-RAILWAY-API-DOMAIN'
$env:LOAD_RPS='2'; $env:LOAD_DURATION_SECONDS='1'; $env:LOAD_CONCURRENCY='2'; npm.cmd run loadtest:trades
```

Clean deployed synthetic writes by setting `DATABASE_URL` to the Railway Postgres connection string locally and running:

```powershell
npm.cmd run loadtest:cleanup
```

## k6 Report URL

The System of Record still needs the public k6 HTML report URL.

Use:

```text
reports/k6-trades-report.html
```

Upload that file to GitHub Pages, Railway static site, Netlify, Vercel, or a public Google Drive link.
