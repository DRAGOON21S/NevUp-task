# NevUp Trade Journal Backend

Backend implementation for the NevUp Hackathon 2026 Trade Journal track.

The service ingests the provided trade seed dataset, exposes the required OpenAPI-style endpoints, enforces JWT tenant isolation, records idempotent trade close events, and processes analytics asynchronously through Redis Streams.

## What Is Included

- TypeScript Node HTTP API
- PostgreSQL schema, migration, seed loader, and metric backfill
- Redis Streams analytics worker
- JWT auth using the provided hackathon secret
- Idempotent `POST /trades`
- Tenant isolation on all user-owned resources
- Structured JSON errors with trace IDs
- Load tools for write/read performance targets
- Integration test covering the required endpoint surface
- Railway deployment configs
- Render Blueprint fallback

## Required Endpoints

- `POST /trades`
- `GET /trades/{tradeId}`
- `GET /sessions/{sessionId}`
- `POST /sessions/{sessionId}/debrief`
- `GET /sessions/{sessionId}/coaching`
- `GET /users/{userId}/metrics`
- `GET /users/{userId}/profile`
- `GET /health`

## Quick Start

One-command Docker startup:

```powershell
$env:PATH = 'C:\Program Files\Docker\Docker\resources\bin;' + $env:PATH
& 'C:\Program Files\Docker\Docker\resources\bin\docker.exe' compose up --build
```

This starts Postgres, Redis, migration, seed, API, and analytics worker.

Health check:

```powershell
Invoke-RestMethod -Uri http://localhost:4010/health | ConvertTo-Json -Depth 5
```

Manual local startup:

Install dependencies:

```powershell
npm.cmd install
```

Start Postgres and Redis:

```powershell
$env:PATH = 'C:\Program Files\Docker\Docker\resources\bin;' + $env:PATH
& 'C:\Program Files\Docker\Docker\resources\bin\docker.exe' compose up -d postgres redis
```

Run migration and seed:

```powershell
npm.cmd run db:phase1
```

Start the API:

```powershell
npm.cmd run start
```

Start the analytics worker in another terminal:

```powershell
npm.cmd run worker
```

Health check:

```powershell
Invoke-RestMethod -Uri http://localhost:4010/health | ConvertTo-Json -Depth 5
```

## Verification

Build:

```powershell
npm.cmd run build
```

Integration test:

```powershell
npm.cmd run test:integration
```

Judge demo script:

```powershell
npm.cmd run demo:judge
```

Deployment smoke after Railway is live:

```powershell
$env:DEPLOY_BASE_URL='https://YOUR-API-URL'
npm.cmd run smoke:deploy
```

Short write/read smoke:

```powershell
$env:LOAD_RPS='2'; $env:LOAD_DURATION_SECONDS='1'; $env:LOAD_CONCURRENCY='2'; npm.cmd run loadtest:trades
$env:LOAD_RPS='5'; $env:LOAD_DURATION_SECONDS='2'; $env:LOAD_CONCURRENCY='5'; npm.cmd run loadtest:reads
```

Full write target:

```powershell
$env:REQUEST_LOG_SAMPLE_RATE='0.01'
$env:LOAD_RPS='200'; $env:LOAD_DURATION_SECONDS='60'; $env:LOAD_CONCURRENCY='100'; $env:LOAD_SESSION_COUNT='100'; npm.cmd run loadtest:trades
```

Full read target:

```powershell
$env:REQUEST_LOG_SAMPLE_RATE='0.01'
$env:LOAD_READ_RPS='100'; $env:LOAD_READ_DURATION_SECONDS='60'; $env:LOAD_READ_CONCURRENCY='50'; npm.cmd run loadtest:reads
```

k6 HTML report for System of Record:

```powershell
$env:NEVUP_K6_BASE_URL='http://localhost:4010'
$env:NEVUP_K6_RPS='200'
$env:NEVUP_K6_DURATION='60s'
$env:NEVUP_K6_SESSION_COUNT='100'
npm.cmd run k6:write
```

This writes `reports/k6-trades-report.html`.

Public System of Record k6 report URL:

```text
https://nevup-k6-report.vercel.app/k6-trades-report
```

Latest generated k6 reports:

- `reports/k6-trades-report.html`: `11971` requests, failure rate `0`, p95 `16.88ms`
- `reports/k6-reads-report.html`: `6001` requests, failure rate `0`, p95 `5.45ms`

Cleanup synthetic load-test writes:

```powershell
npm.cmd run loadtest:cleanup
```

## Latest Local Performance Proof

- Write target with API and analytics worker running:
  - `12000` completed writes
  - `0` errors
  - p95 write latency `19ms`
- Read target:
  - `6000` completed reads
  - `0` errors
  - p95 read latency `6ms`
- Cleanup restored the database to:
  - `388` trades
  - `52` sessions
  - `0` unpublished outbox rows

More detail is in `docs/performance.md`.

## Submission Docs

- `DECISIONS.md`: architecture and tradeoff notes.
- `docs/performance.md`: load-test commands and latest evidence.
- `docs/deployment.md`: Render deployment notes.
- `docs/railway.md`: Railway deployment steps.
- `docs/demo-script.md`: live demo flow.
- `docs/final-evidence.md`: final proof points.
- `docs/k6-reporting.md`: k6 HTML report generation and hosting steps.
- `docs/nevup_openapi.yaml`: provided API contract copy.
- `docs/jwt_format.md`: provided JWT format copy.
- `SUBMISSION_CHECKLIST.md`: final demo and packaging checklist.
