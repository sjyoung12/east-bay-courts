# East Bay Courts

One mobile-friendly page showing which public tennis courts are free in Berkeley and Oakland.

**Live:** https://sjyoung12.github.io/east-bay-courts/

Both cities are fetched by a GitHub Actions job (`.github/workflows/deploy.yml`) that writes snapshot files and redeploys GitHub Pages. The page only reads those files, so it loads instantly and adds no load to either city's site.

- **Berkeley:** `scripts/fetch-berkeley.mjs` reads CivicRec's slot API (`/permits/getMultiFacilityAvailabilityBySlot`) and writes `site/data/berkeley.json`. Court IDs are hard-coded there; San Pablo #4–6 are left out because they're kept for walk-ons.
- **Oakland:** `scripts/fetch-oakland.mjs` reads PerfectMind (which needs a per-session anti-forgery token) and writes `site/data/oakland.json`. Courts are discovered on every run; Montclair's pickleball ("PB") courts are filtered out.
- **What starts the refresh:** a cron-job.org job POSTs to the workflow-dispatch API every 15 minutes from 5am to 10:45pm Pacific, using a fine-grained token limited to Actions on this repo. GitHub's own `schedule:` trigger is still in the workflow as a backup, but it's best-effort and never fired for this repo when it was new.

Tapping an open block or a court number opens the city's own booking page. Oakland links go straight to the specific court. Berkeley links open the park filtered to the chosen date, because Berkeley's cart is tied to a browser session.

## Maintenance notes

- If the data stops updating, check cron-job.org first. The usual cause is an expired GitHub token: create a new one (Actions: read and write on this repo only) and paste it into the job's `Authorization` header.
- GitHub disables the backup `schedule:` trigger after 60 days with no repository activity. That doesn't affect the cron-job.org trigger.
- Run the workflow by hand from **Actions → Refresh court data and deploy → Run workflow**.
