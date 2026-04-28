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

- Upload `reports/k6-trades-report.html` to a public URL.

Recommended System of Record URL target:

```text
https://YOUR-GITHUB-USERNAME.github.io/YOUR-REPO/reports/k6-trades-report.html
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
