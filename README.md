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
- `assets/site.js` records first interactions with the official HESS video, the short teaser, and the video DOI through separate counter IDs.
- Open `/analytics.html` to read the counters without incrementing them and calculate approximate click/play rates.
- These counters are intentionally lightweight rather than a full analytics platform: reloads may add views, and the owner dashboard exposes only aggregate counts rather than individual visitor records.
- Local previews never increment the lightweight counters. Launch-validation baseline (August 18, 2026): subtract `1` from each displayed counter; the Flag Counter map includes `2` New York test pageviews.
