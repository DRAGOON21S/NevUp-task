# Submission Checklist

Use this before packaging or demoing the project.

## Required Files

- `README.md`
- `DECISIONS.md`
- `docs/performance.md`
- `docs/deployment.md`
- `docs/railway.md`
- `docs/demo-script.md`
- `docs/final-evidence.md`
- `docs/k6-reporting.md`
- `docs/nevup_openapi.yaml`
- `docs/jwt_format.md`
- `data/nevup_seed_dataset.csv`
- `data/nevup_seed_dataset.json`
- `render.yaml`
- `railway.api.toml`
- `railway.worker.toml`

## Local Verification

```powershell
npm.cmd install
npm.cmd run build
```

Start dependencies:

```powershell
$env:PATH = 'C:\Program Files\Docker\Docker\resources\bin;' + $env:PATH
& 'C:\Program Files\Docker\Docker\resources\bin\docker.exe' compose up -d postgres redis
```

Migrate and seed:

```powershell
npm.cmd run db:phase1
```

Run API and worker:

```powershell
$env:REQUEST_LOG_SAMPLE_RATE='0.01'
npm.cmd run start
npm.cmd run worker
```

Run integration:

```powershell
npm.cmd run test:integration
```

Run the judge demo script:

```powershell
npm.cmd run demo:judge
```

Run full write target:

```powershell
$env:LOAD_RPS='200'; $env:LOAD_DURATION_SECONDS='60'; $env:LOAD_CONCURRENCY='100'; $env:LOAD_SESSION_COUNT='100'; npm.cmd run loadtest:trades
```

Run read target:

```powershell
$env:LOAD_READ_RPS='100'; $env:LOAD_READ_DURATION_SECONDS='60'; $env:LOAD_READ_CONCURRENCY='50'; npm.cmd run loadtest:reads
```

Run k6 write report:

```powershell
$env:NEVUP_K6_BASE_URL='http://localhost:4010'
$env:NEVUP_K6_RPS='200'
$env:NEVUP_K6_DURATION='60s'
$env:NEVUP_K6_SESSION_COUNT='100'
npm.cmd run k6:write
```

Required System of Record URL:

- Upload `reports/k6-trades-report.html` to a public URL.
- Paste that URL into the k6/Locust HTML report field.
- Latest local file generated: `reports/k6-trades-report.html`.

Clean synthetic load data:

```powershell
npm.cmd run loadtest:cleanup
```

## Judge Demo Flow

1. Show `/health`.
2. Show seeded counts: `388` trades, `10` users, `52` sessions.
3. Submit the same `POST /trades` payload twice and show identical response bodies.
4. Use a different-user JWT and show cross-tenant `403`.
5. Show metrics/profile endpoints.
6. Show SSE coaching emits `event: done`.
7. Show `DECISIONS.md` performance evidence.
8. Show the public k6 HTML report URL.

## Railway Deployment

Create Railway services:

- Postgres
- Redis
- API service using `/railway.api.toml`
- Worker service using `/railway.worker.toml`

After Railway is live:

```powershell
$env:DEPLOY_BASE_URL='https://YOUR-API-URL'
npm.cmd run smoke:deploy
```

For a deployed write smoke:

```powershell
$env:LOAD_BASE_URL='https://YOUR-API-URL'
$env:LOAD_RPS='2'; $env:LOAD_DURATION_SECONDS='1'; $env:LOAD_CONCURRENCY='2'; npm.cmd run loadtest:trades
```

Clean remote synthetic writes by setting `DATABASE_URL` to the deployed database connection string and running:

```powershell
npm.cmd run loadtest:cleanup
```
