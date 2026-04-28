# Final Evidence

This file captures the final proof points to use in the submission or demo.

## Build

Command:

```powershell
npm.cmd run build
```

Result:

- TypeScript build passed.

## Judge Demo

Command:

```powershell
npm.cmd run demo:judge
```

Verified demo steps:

- `/health` returned `status: ok`.
- Seed trade read returned trade `9c967550-357f-4bfb-9726-c8b863e968ce`.
- Seed session read returned session `4f39c2ea-8687-41f7-85a0-1fafd3e976df`.
- Duplicate `POST /trades` returned `200` twice with identical bodies.
- Cross-tenant trade read returned `403 FORBIDDEN`.
- Metrics endpoint returned daily time-series data.
- Profile endpoint returned dominant pathology evidence and strengths.
- SSE coaching endpoint emitted `event: done`.

## Performance Proof

Latest local Phase 5 run:

- Write target:
  - API and analytics worker running.
  - `LOAD_RPS=200`
  - `LOAD_DURATION_SECONDS=60`
  - `LOAD_CONCURRENCY=100`
  - `LOAD_SESSION_COUNT=100`
  - `REQUEST_LOG_SAMPLE_RATE=0.01`
  - `12000` completed
  - `0` errors
  - p95 write latency `19ms`
- Read target:
  - `LOAD_READ_RPS=100`
  - `LOAD_READ_DURATION_SECONDS=60`
  - `LOAD_READ_CONCURRENCY=50`
  - `6000` completed
  - `0` errors
  - p95 read latency `6ms`

## k6 HTML Report

Generated:

- `k6/trades.js`
- `k6/reads.js`
- `npm.cmd run k6:write`
- `npm.cmd run k6:read`
- `reports/k6-trades-report.html`
- `reports/k6-trades-summary.json`
- `reports/k6-reads-report.html`
- `reports/k6-reads-summary.json`

k6 write report result:

- `11971` requests
- failure rate `0`
- checks rate `1`
- p95 latency `16.88ms`

k6 read report result:

- `6001` requests
- failure rate `0`
- checks rate `1`
- p95 latency `5.45ms`

Pending for System of Record:

- Public k6 write report URL:

```text
https://nevup-k6-report.vercel.app/k6-trades-report
```

Recommended System of Record URL target:

```text
https://nevup-k6-report.vercel.app/k6-trades-report
```

## Cleanup Proof

After the full load run, synthetic load-test trades were cleaned.

Verified database state:

- `388` trades
- `52` sessions
- `0` unpublished outbox rows

## Deployment Readiness

Railway config:

- `railway.api.toml`
- `railway.worker.toml`
- `docs/railway.md`

Render fallback:

- `render.yaml`

Deploy smoke:

```powershell
$env:DEPLOY_BASE_URL='https://YOUR-API-URL'
npm.cmd run smoke:deploy
```

The deploy smoke checks health, seed reads, metrics, profile, and idempotent write behavior.

## Railway Deployment Verification

Railway API URL:

```text
https://nevup-api-production.up.railway.app
```

Health check:

- `GET /health`
- status `200`
- response status `ok`
- database `connected`

Deploy smoke:

- command: `npm.cmd run smoke:deploy`
- base URL: `https://nevup-api-production.up.railway.app`
- result: passed
- checks:
  - `GET /health` -> `200`
  - `GET /trades/9c967550-357f-4bfb-9726-c8b863e968ce` -> `200`
  - `GET /sessions/4f39c2ea-8687-41f7-85a0-1fafd3e976df` -> `200`
  - `GET /users/f412f236-4edc-47a2-8f54-8763a6ed2ce8/metrics` -> `200`
  - `GET /users/f412f236-4edc-47a2-8f54-8763a6ed2ce8/profile` -> `200`
  - duplicate `POST /trades` -> `200`, `200`
- synthetic deployment smoke trade: `c7e2b0bc-a3e0-4150-94a6-745804884d77`
- synthetic deployment smoke session: `be2fe178-641b-4ecf-ab72-bc4dc17782d9`

Tiny deployed write smoke:

- `LOAD_RPS=2`
- `LOAD_DURATION_SECONDS=1`
- `LOAD_CONCURRENCY=2`
- completed `2`
- errors `0`
- p95 `758ms`
- synthetic load-test session: `fceba288-5523-4c91-a619-bffe9fa4be26`
