# Wenli Zhao — Academic Website

Dependency-free academic website for Wenli Zhao, built with plain HTML and CSS and published with GitHub Pages.

Target URL: <https://zhaowilliam.github.io/>

## Local preview

From the repository root, run:

```sh
python3 -m http.server 4173
```

Then open <http://localhost:4173/>.

## Content update checklist

- Update current position, bio, and contact links in `index.html`.
- Add recent highlights and selected publications to `index.html`.
- Keep the full publication record and status labels current in `publications.html`.
- Replace `assets/documents/Wenli_Zhao_CV.pdf` when the CV changes.
- Check links and mobile layout before publishing.

## Lightweight analytics

### Private activity reports (September 2026)

The owner page `/analytics.html` now supports a token-protected activity report in addition to the existing map and CSV. Public page layout is unchanged. Reports cover the previous 30 days, disclose their row/display limits, and distinguish session counts from people. Old events remain available but cannot be retroactively assigned missing click details or sessions.

- Paper/DOI, CV, contact, navigation and external-link clicks include a label, sanitized destination, placement and research topic where known.
- Temporary per-tab visit IDs and per-page event sequence support approximate paths. Session IDs expire after 30 minutes without recorded activity or eight hours maximum; there is no persistent cross-visit visitor ID. Browser storage failures degrade gracefully.
- Section exposure, scroll milestones, foreground-time deltas, actual-played teaser milestones, coarse device/browser/viewport categories, load time and bounded resource failures provide lightweight engagement/quality signals. TIB iframe playback progress is not collected.
- Share channel-level links using `utm_source`, `utm_medium`, and `utm_campaign` (letters, digits, underscores or hyphens; maximum 64 characters each). Example: `https://zhaowilliam.github.io/?utm_source=linkedin&utm_medium=social&utm_campaign=research`. Never put personal names, email addresses, account IDs or secrets in campaign labels. Forwarded links retain their labels, so these are attribution hints rather than proof of origin. Google search-query reporting is not connected; that requires separate Search Console access.
- GPC, DNT, local previews, and the owner dashboard's optional **Exclude this browser** preference suppress collection. The latter stores `wenli.analytics.disabled=1` in localStorage only as an opt-out switch. Enable it manually in each browser used for testing. Do not label cloud/ISP traffic as confirmed bots or a particular person's identity.
- The collector accepts only bounded, allowlisted event metadata; URLs omit queries/fragments and email links store only `mailto`. Event UUIDs deduplicate repeat deliveries. No form text, mouse tracing, recordings, fingerprinting or third-party analytics library is added.
- `/events.json?days=30&limit=1000&before=ID` uses the same Bearer token as CSV/map, returns `{events, days, next_before}`, and is `no-store`. `details` is a validated object; CSV adds `event_id`, `session_id`, and `details_json` after the existing columns. IP and session IDs expire after 30 days. Never publish real event exports or screenshots containing visitor records in this repository.

### Checks and safe upgrade

Run the dependency-free logic checks with Node.js 24 or later:

```sh
node --test tests/*.test.mjs
```

For this existing production database, apply the additive migration **before** deploying the Worker, then publish the public scripts/dashboard. Do not re-create the database or rotate existing secrets:

```sh
cd analytics-worker
wrangler d1 migrations list wenli-site-analytics --remote
wrangler d1 migrations apply wenli-site-analytics --remote
wrangler deploy --dry-run
wrangler deploy
```

For a completely new database, first execute `schema.sql`, then apply `migrations/`, then configure secrets and deploy. Rollback of code does not require dropping the new nullable/defaulted columns. The old collector remains compatible with the upgraded schema.

- Legacy badge counters in `assets/site.js` retain the public click/play-rate baseline.
- `analytics-worker/` contains the dependency-free Cloudflare Worker and D1 schema for page views, selected interactions, raw IP retention for 30 days, approximate IP-derived geography, a token-protected city-level map feed, and private CSV export.
- The production endpoint is `https://wenli-site-api.wenlizhao.workers.dev`; it is set in the `analytics-endpoint` meta tag on tracked pages.
- Open `/analytics.html` for the legacy counters, token-protected interactive satellite visitor map, and CSV download. The map calls `/locations.json`, which returns at most 1,000 city-level aggregates: one marker per city, marker size based on approximate visitor count, total page views, and the latest visit time. Drag to move the map; use the mouse wheel, pinch gesture, or controls to zoom. It never returns IP addresses or visitor identifiers. Visitor counts are approximate because the pseudonymous visitor hash rotates monthly. The CSV export retrieves all available records in 5,000-row batches. Never commit `ADMIN_TOKEN`, `HASH_SECRET`, `.dev.vars`, or a downloaded event CSV; delete local CSV exports within 30 days.
- The private export token is stored locally in the ignored file `analytics-worker/.admin-token` with owner-only permissions.
- Local previews never increment the lightweight counters. Launch-validation baseline (August 18, 2026): subtract `1` from each displayed counter; the private map includes `2` New York test pageviews.

### Cloudflare deployment

The production database and Worker are already deployed. For a future clean redeployment from `analytics-worker/`:

```sh
wrangler d1 create wenli-site-analytics
# Put the returned database_id into wrangler.jsonc.
wrangler d1 execute wenli-site-analytics --remote --file=schema.sql
wrangler d1 migrations apply wenli-site-analytics --remote
wrangler secret put HASH_SECRET
wrangler secret put ADMIN_TOKEN
wrangler deploy
```

Use independent random values of at least 32 bytes for both secrets. The Worker rate-limits collection requests and runs hourly cleanup that removes raw IP addresses after 30 days while retaining the monthly pseudonymous identifier and approximate geographic fields. The private export also suppresses any raw IP older than 30 days. Network-derived city, postal code, and coordinates are estimates rather than GPS locations.
