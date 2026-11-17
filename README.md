# East Bay Courts

One mobile-friendly page showing which public tennis courts are free in Berkeley and Oakland.

**Live:** https://sjyoung12.github.io/east-bay-courts/

- **Berkeley** availability is read live in your browser from the city's CivicRec slot API (`/permits/getMultiFacilityAvailabilityBySlot`), which allows cross-origin requests.
- **Oakland** uses PerfectMind, which needs a per-session anti-forgery token and blocks cross-origin requests. A GitHub Actions job (`.github/workflows/deploy.yml`) runs `scripts/fetch-oakland.mjs` about every 15 minutes from 5am to 11pm Pacific, writes `site/data/oakland.json`, and redeploys GitHub Pages.

"Book" links open the city's own booking page. Oakland links go straight to the specific court. Berkeley links open the park filtered to the chosen date, because Berkeley's cart is tied to a browser session.

## Maintenance notes

- GitHub disables scheduled workflows after 60 days with no repository activity. If Oakland data stops updating, re-enable the workflow under **Actions**, or push any commit.
- Berkeley court IDs are hard-coded in `site/index.html` (`BK_PARKS`). Oakland courts are discovered on every run.
- Run the workflow by hand from **Actions → Refresh Oakland data and deploy → Run workflow**.
