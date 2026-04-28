# Judge Demo Script

Use this flow for a short live walkthrough.

## Setup

Start everything with one Docker command:

```powershell
$env:PATH = 'C:\Program Files\Docker\Docker\resources\bin;' + $env:PATH
& 'C:\Program Files\Docker\Docker\resources\bin\docker.exe' compose up --build
```

Manual alternative:

```powershell
$env:PATH = 'C:\Program Files\Docker\Docker\resources\bin;' + $env:PATH
& 'C:\Program Files\Docker\Docker\resources\bin\docker.exe' compose up -d postgres redis
npm.cmd run db:phase1
$env:REQUEST_LOG_SAMPLE_RATE='0.01'
npm.cmd run start
npm.cmd run worker
```

## Automated Demo

In a separate terminal:

```powershell
npm.cmd run demo:judge
```

The script demonstrates:

- `/health`
- seeded trade read
- seeded session read
- idempotent `POST /trades`
- cross-tenant `403`
- metrics
- profile
- SSE coaching completion
- performance proof summary

## Manual Talking Points

- The API write path is intentionally small: validate, tenant-check, idempotency-check, insert trade, increment session summary, insert durable outbox event.
- Redis Streams and a separate worker handle analytics after the response, so close-event writes do not wait for metric recomputation.
- Tenant isolation is enforced by matching every user-owned resource to JWT `sub`.
- Latest local proof: `12000` writes at `200 rps` for `60s`, `0` errors, p95 `19ms`; read p95 `6ms`.
