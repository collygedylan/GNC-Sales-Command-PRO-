# GNC Sales Command Pro

Current production repo contents:

- `index.html`, `manifest.json`, `sw.js`, `CNAME`, `.nojekyll`, and app icons/logos for the GitHub Pages app.
- `Code.gs` plus `scripts/sync-codegs-to-apps-script.js` for the deployed Google Apps Script endpoint.
- `.github/workflows/` for Pages, Apps Script sync, ML model sync/training, ML queue processing, and weather hold learning.
- `supabase/functions/` for current Supabase Edge Functions.
- ML worker code, models, and requirements used by the scheduled GitHub Actions workflows.

Old one-off SQL migrations, repair scripts, duplicate assets, and placeholder files are intentionally not kept in this repo.
