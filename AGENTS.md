# HerWay — Acodemic X G.I.R.L.S. Global SDG Hackathon

## Project Context

**HerWay** is a safety-aware walking route planner for women, built for the
[Acodemic X G.I.R.L.S. Global SDG Hackathon](https://acodemic-hackathon.devpost.com/).

- **Deadline**: Sep 26, 2026 @ 11:45pm CDT
- **SDG alignment**: SDG 5 (Gender Equality) + SDG 11 (Sustainable Cities & Communities)
- **Judging criteria**: SDG Impact & Relevance, Creativity & Originality, Execution & Functionality
- **Audience**: beginner-friendly, student judges from Acodemic (education) and G.I.R.L.S. (women in STEM nonprofit)

## Submission Checklist

- [ ] Publicly accessible project link (deploy to GitHub Pages / Vercel / Netlify)
- [ ] Project description (inspiration, SDG alignment) — see README.md
- [ ] At least 3 screenshots → put in `screenshots/`
- [ ] Demo video 1–5 min (optional)
- [ ] Tech list: Leaflet, OpenStreetMap, OSRM, Overpass API, vanilla JS
- [ ] Source code public on GitHub

## Tech Stack

Vanilla HTML/CSS/JS — **no build step, no dependencies to install**. Deliberate
choice: maximum robustness for demo + one-drag deployment to any static host.

- Map: Leaflet + CartoDB dark tiles (free, no API key)
- Routing: OSRM public demo server (foot profile, alternatives) w/ offline fallback
- Geocoding: Nominatim (search box) w/ click-on-map fallback
- Safe havens: Overpass API (police/hospital/pharmacy/convenience) w/ deterministic synthetic fallback
- Crowd reports: localStorage + seeded demo data

## Commands

```bash
# Run locally (must be served over HTTP for map tiles/fetch)
python3 -m http.server 8000
# → http://localhost:8000
```

No tests/lint configured — hackathon scope. Verify by loading the page and
checking the browser console.

## Architecture

```
index.html        Single-page app: sidebar controls + map + overlays
css/styles.css    Dark theme, violet/teal accents
js/data.js        Seeded RNG, procedural safety grid, city presets, safe havens
js/safety.js      Route scoring model (lighting/traffic/crime/open-late, time-weighted)
js/routing.js     OSRM fetch + fallback route generator
js/map.js         Leaflet setup, heat overlay, route rendering, markers
js/reports.js     Crowdsourced reports (pin + category + localStorage)
js/fakecall.js    Fake incoming call (WebAudio ring, timed call screen)
js/safewalk.js    "Walk With Me" companion: simulated trip, check-ins,
                  danger-zone alerts, share link, SOS + reverse-geocoded location
js/app.js         UI wiring, state, geocoding, city selector
```

## Demo video (demo.mp4)

Produced by `~/tools/demo-recorder` — scene spec: `~/tools/demo-recorder/scenes/herway.js`.

```bash
cd ~/tools/demo-recorder
node record-demo.js scenes/herway.js --out=/home/yap/Hack/Acodemic/demo.mp4
```

- Narrative slides live in Figma file `pHHhMPNGFezhSBlCUCvhyo`
  (frames `8:2` hook / `8:8` model / `8:29` roadmap) — pulled via `card.figma`
  REST (`FIGMA_TOKEN` in env). Edit slides in Figma web/app, re-run to refresh.
- HTML source of the same slides: `assets/slides.html` → re-shoot with
  `node ~/tools/demo-recorder/tools/frames.js assets/slides.html` in assets/.
- Live scenes share `session: "app"` — one continuous page, cards overlay it.
- Intermediates land in `demo.work/` (timestamps.json, raw webms, segments).

## Conventions

- Keep it dependency-free; CDN <script> tags only (Leaflet).
- All "live" features must have offline/deterministic fallbacks — demo must
  never break on hotel wifi.
- Safety scoring must stay transparent & explainable (breakdown bars) — it's a
  judging differentiator ("not a black box").
- Demo honesty: label synthetic data as demo data in UI/README.
- Coordinate order: OSRM/GeoJSON = [lon,lat], Leaflet = [lat,lng]. Swap carefully.

## Honesty Rules for Devpost

- Describe dataset as "procedural demo model; production would fuse OSM + city
  open data + crowd reports." Do not claim real crime data integration.
- SOS/notifications are simulated — say so.
