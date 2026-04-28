# Performance Runbook

This project includes local load tools for the two hackathon targets:

- Write target: 200 closed trades/sec for 60 seconds, p95 <= 150 ms.
- Read target: p95 <= 200 ms.

Start dependencies:

```powershell
$env:PATH = 'C:\Program Files\Docker\Docker\resources\bin;' + $env:PATH
& 'C:\Program Files\Docker\Docker\resources\bin\docker.exe' compose up -d postgres redis
```

Or start the full stack with one command:

```powershell
$env:PATH = 'C:\Program Files\Docker\Docker\resources\bin;' + $env:PATH
& 'C:\Program Files\Docker\Docker\resources\bin\docker.exe' compose up --build
```

Start the API and worker from separate terminals. For load runs, lower request log sampling so console I/O does not dominate latency:

```powershell
$env:REQUEST_LOG_SAMPLE_RATE='0.01'
npm.cmd run start
npm.cmd run worker
```

Run a short smoke:

```powershell
$env:LOAD_RPS='2'; $env:LOAD_DURATION_SECONDS='1'; $env:LOAD_CONCURRENCY='2'; npm.cmd run loadtest:trades
$env:LOAD_RPS='5'; $env:LOAD_DURATION_SECONDS='2'; $env:LOAD_CONCURRENCY='5'; npm.cmd run loadtest:reads
```

Run the write target:

```powershell
$env:LOAD_RPS='200'; $env:LOAD_DURATION_SECONDS='60'; $env:LOAD_CONCURRENCY='100'; $env:LOAD_SESSION_COUNT='100'; npm.cmd run loadtest:trades
```

The write load tool reports completed requests, errors, p50/p95/p99 latency, and endpoint-level p95.
`LOAD_SESSION_COUNT` spreads synthetic close events across sessions so the run measures API throughput instead of one hot session row.
`LOAD_REQUEST_TIMEOUT_MS` caps each request; timed-out requests are reported as status `599`.

Run the read target:

```powershell
$env:LOAD_READ_RPS='100'; $env:LOAD_READ_DURATION_SECONDS='60'; $env:LOAD_READ_CONCURRENCY='50'; npm.cmd run loadtest:reads
```

Run the required k6 HTML write report:

```powershell
$env:NEVUP_K6_BASE_URL='http://localhost:4010'
$env:NEVUP_K6_RPS='200'
$env:NEVUP_K6_DURATION='60s'
$env:NEVUP_K6_SESSION_COUNT='100'
npm.cmd run k6:write
```

This creates:

- `reports/k6-trades-report.html`
- `reports/k6-trades-summary.json`

Upload `reports/k6-trades-report.html` to a public URL for the System of Record.

Clean load-test writes and refresh seed metrics:

```powershell
npm.cmd run loadtest:cleanup
```

Latest local Phase 5 results:

- Write target with API and analytics worker running:
  - `LOAD_RPS=200`
  - `LOAD_DURATION_SECONDS=60`
  - `LOAD_CONCURRENCY=100`
  - `LOAD_SESSION_COUNT=100`
  - `REQUEST_LOG_SAMPLE_RATE=0.01`
  - `12000` completed, `0` errors
  - p95 write latency `19ms`
- Read target:
  - `LOAD_READ_RPS=100`
  - `LOAD_READ_DURATION_SECONDS=60`
  - `LOAD_READ_CONCURRENCY=50`
  - `6000` completed, `0` errors
  - p95 read latency `6ms`
- Cleanup restored the seeded database to `388` trades, `52` sessions, and `0` unpublished outbox rows.

Latest local k6 report results:

- Write report:
  - file: `reports/k6-trades-report.html`
  - `11971` requests
  - failure rate `0`
  - checks rate `1`
  - p95 latency `16.88ms`
- Read report:
  - file: `reports/k6-reads-report.html`
  - `6001` requests
  - failure rate `0`
  - checks rate `1`
  - p95 latency `5.45ms`
- Cleanup restored the seeded database to `388` trades, `52` sessions, and `0` unpublished outbox rows.

Useful tuning knobs:

- `POOL_MAX`: Postgres API pool size, default `50`.
- `REQUEST_LOG_SAMPLE_RATE`: successful request log sampling rate, default `1`; errors are always logged.
- `WORKER_BATCH_SIZE`: worker outbox/stream batch size, default `50`.
- `LOAD_CONCURRENCY`: write load client concurrency.
- `LOAD_SESSION_COUNT`: synthetic session spread for write load, default `100`.
- `LOAD_REQUEST_TIMEOUT_MS`: write request timeout, default `5000`.
- `LOAD_READ_CONCURRENCY`: read load client concurrency.
