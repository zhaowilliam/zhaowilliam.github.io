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

- The homepage footer uses Flag Counter map ID `ahHd` for aggregate page views and country-level visitor geography.
- Legacy badge counters in `assets/site.js` retain the public click/play-rate baseline.
- `analytics-worker/` contains the dependency-free Cloudflare Worker and D1 schema for page views, selected interactions, raw IP retention for 30 days, approximate IP-derived geography, and private CSV export.
- The production endpoint is `https://wenli-site-api.wenlizhao.workers.dev`; it is set in the `analytics-endpoint` meta tag on tracked pages.
- Open `/analytics.html` for the legacy counters and token-protected CSV download. The dashboard retrieves all available records in 5,000-row batches. Never commit `ADMIN_TOKEN`, `HASH_SECRET`, `.dev.vars`, or a downloaded event CSV; delete local CSV exports within 30 days.
- The private export token is stored locally in the ignored file `analytics-worker/.admin-token` with owner-only permissions.
- Local previews never increment the lightweight counters. Launch-validation baseline (August 18, 2026): subtract `1` from each displayed counter; the Flag Counter map includes `2` New York test pageviews.

### Cloudflare deployment

The production database and Worker are already deployed. For a future clean redeployment from `analytics-worker/`:

```sh
wrangler d1 create wenli-site-analytics
# Put the returned database_id into wrangler.jsonc.
wrangler d1 execute wenli-site-analytics --remote --file=schema.sql
wrangler secret put HASH_SECRET
wrangler secret put ADMIN_TOKEN
wrangler deploy
```

Use independent random values of at least 32 bytes for both secrets. The Worker rate-limits collection requests and runs hourly cleanup that removes raw IP addresses after 30 days while retaining the monthly pseudonymous identifier and approximate geographic fields. The private export also suppresses any raw IP older than 30 days. Network-derived city, postal code, and coordinates are estimates rather than GPS locations.
