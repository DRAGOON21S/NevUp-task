# Load Test Reports

k6 writes HTML and JSON reports here:

- `k6-trades-report.html`
- `k6-trades-summary.json`
- `k6-reads-report.html`
- `k6-reads-summary.json`

Run from the project root:

```powershell
npm.cmd run k6:write
npm.cmd run k6:read
```

The System of Record asks for a URL. Upload the generated HTML report to a public location, for example:

- GitHub Pages
- a Render static site
- Google Drive with public sharing
- Netlify/Vercel static deploy
