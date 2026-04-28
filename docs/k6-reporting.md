# k6 Reporting

The System of Record requires a URL to a k6 or Locust HTML load-test results report.

This project now includes k6 scripts that generate HTML reports:

- `k6/trades.js` -> `reports/k6-trades-report.html`
- `k6/reads.js` -> `reports/k6-reads-report.html`

## Install k6

k6 is not bundled with npm dependencies. Install it once on the machine that will run the final report.

Windows options:

```powershell
winget install k6.k6
```

or:

```powershell
choco install k6
```

Verify:

```powershell
k6 version
```

## Run Local k6 Reports

Start dependencies, API, and worker first:

```powershell
$env:PATH = 'C:\Program Files\Docker\Docker\resources\bin;' + $env:PATH
& 'C:\Program Files\Docker\Docker\resources\bin\docker.exe' compose up -d postgres redis
npm.cmd run db:phase1
$env:REQUEST_LOG_SAMPLE_RATE='0.01'
npm.cmd run start
npm.cmd run worker
```

Run write k6 test:

```powershell
$env:NEVUP_K6_BASE_URL='http://localhost:4010'
$env:NEVUP_K6_RPS='200'
$env:NEVUP_K6_DURATION='60s'
$env:NEVUP_K6_SESSION_COUNT='100'
npm.cmd run k6:write
```

Run read k6 test:

```powershell
$env:NEVUP_K6_BASE_URL='http://localhost:4010'
$env:NEVUP_K6_READ_RPS='100'
$env:NEVUP_K6_READ_DURATION='60s'
npm.cmd run k6:read
```

Clean synthetic write data:

```powershell
npm.cmd run loadtest:cleanup
```

## Run Against Deployed API

After Render is live:

```powershell
$env:NEVUP_K6_BASE_URL='https://YOUR-API-URL'
$env:NEVUP_K6_RPS='200'
$env:NEVUP_K6_DURATION='60s'
$env:NEVUP_K6_SESSION_COUNT='100'
npm.cmd run k6:write
```

Then run:

```powershell
$env:NEVUP_K6_BASE_URL='https://YOUR-API-URL'
$env:NEVUP_K6_READ_RPS='100'
$env:NEVUP_K6_READ_DURATION='60s'
npm.cmd run k6:read
```

## Report URL For System Of Record

The report files are generated locally under `reports/`.

Public report URL for the required System of Record field:

```text
https://nevup-k6-report.vercel.app/k6-trades-report
```

For future report redeploys, upload one HTML report publicly. Recommended:

1. Use `reports/k6-trades-report.html` as the System of Record report because it proves the 200 close-events/sec target.
2. Upload it to GitHub Pages, Render Static Site, Netlify, Vercel, or Google Drive with public sharing.
3. Paste that public URL into the System of Record field.

If you use GitHub Pages, commit the generated `reports/k6-trades-report.html`, enable Pages for the repo, and use:

```text
https://YOUR-GITHUB-USERNAME.github.io/YOUR-REPO/reports/k6-trades-report.html
```

## Latest Generated Local Reports

- `reports/k6-trades-report.html`
  - `11971` requests
  - failure rate `0`
  - checks rate `1`
  - p95 latency `16.88ms`
- `reports/k6-reads-report.html`
  - `6001` requests
  - failure rate `0`
  - checks rate `1`
  - p95 latency `5.45ms`

The database was cleaned after the write report and verified at `388` trades, `52` sessions, and `0` unpublished outbox rows.

## Thresholds

Write test:

- `http_req_failed rate==0`
- `http_req_duration p(95)<150`
- `checks rate==1`

Read test:

- `http_req_failed rate==0`
- `http_req_duration p(95)<200`
- `checks rate==1`
