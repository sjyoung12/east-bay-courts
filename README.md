# East Bay Courts

One mobile-friendly page showing which public tennis courts are free in Berkeley and Oakland.

**Live:** https://sjyoung12.github.io/east-bay-courts/

- **Berkeley** availability is read live in your browser from the city's CivicRec slot API (`/permits/getMultiFacilityAvailabilityBySlot`), which allows cross-origin requests.
- **Oakland** uses PerfectMind, which needs a per-session anti-forgery token and blocks cross-origin requests. A GitHub Actions job (`.github/workflows/deploy.yml`) runs `scripts/fetch-oakland.mjs`, writes `site/data/oakland.json`, and redeploys GitHub Pages.
- **What starts the Oakland refresh:** a cron-job.org job POSTs to the workflow-dispatch API every 15 minutes from 5am to 10:45pm Pacific, using a fine-grained token limited to Actions on this repo. GitHub's own `schedule:` trigger is still in the workflow as a backup, but it's best-effort and never fired for this repo when it was new.

"Book" links open the city's own booking page. Oakland links go straight to the specific court. Berkeley links open the park filtered to the chosen date, because Berkeley's cart is tied to a browser session.

## Maintenance notes

- If Oakland data stops updating, check cron-job.org first. The usual cause is an expired GitHub token: create a new one (Actions: read and write on this repo only) and paste it into the job's `Authorization` header.
- GitHub disables the backup `schedule:` trigger after 60 days with no repository activity. That doesn't affect the cron-job.org trigger.
- Berkeley court IDs are hard-coded in `site/index.html` (`BK_PARKS`). Oakland courts are discovered on every run.
- Run the workflow by hand from **Actions → Refresh Oakland data and deploy → Run workflow**.
