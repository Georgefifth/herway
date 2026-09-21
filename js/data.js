/* data.js — deterministic demo dataset.
   Safety factors are procedurally generated per location (seeded by geo-hash),
   so the demo works anywhere in the world and reloads identically.
   Production would fuse OSM + municipal open data + live reports. */
"use strict";

const Data = (() => {

  /* ── seeded RNG ── */
  function hash2(x, y, salt = 0) {
    let h = (Math.imul(x | 0, 374761393) + Math.imul(y | 0, 668265263) + Math.imul(salt, 2246822519)) | 0;
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
  }
  function cellKey(lat, lng) { return [Math.round(lat / CELL), Math.round(lng / CELL)]; }

  const CELL = 0.0025;          // ~250–280m grid cells
  const CITY_SEED = {};          // per-city salt so each city has its own map

  /* ── city presets ── */
  const CITIES = {
    nyc:       { name: "New York",   center: [40.7330, -73.9950], zoom: 14, seed: 11,
                 demo: [[40.7359, -74.0036], [40.7290, -73.9840]],
                 emergency: [["911", "Police / Fire / Medical"], ["311", "City services"]] },
    toronto:   { name: "Toronto",    center: [43.6550, -79.3870], zoom: 14, seed: 22,
                 demo: [[43.6590, -79.3970], [43.6510, -79.3770]],
                 emergency: [["911", "Police / Fire / Medical"], ["211", "Community helpline"]] },
    london:    { name: "London",     center: [51.5150, -0.1180],  zoom: 14, seed: 33,
                 demo: [[51.5210, -0.1280], [51.5100, -0.1060]],
                 emergency: [["999", "Police / Fire / Medical"], ["112", "EU emergency"]] },
    mumbai:    { name: "Mumbai",     center: [19.0590, 72.8350],  zoom: 14, seed: 44,
                 demo: [[19.0650, 72.8260], [19.0520, 72.8430]],
                 emergency: [["112", "All emergencies"], ["103", "Women's helpline"]] },
    singapore: { name: "Singapore",  center: [1.3525, 103.8198],  zoom: 14, seed: 55,
                 demo: [[1.3590, 103.8080], [1.3460, 103.8320]],
                 emergency: [["999", "Police"], ["995", "Ambulance / Fire"]] },
  };

  /* ── crime "hotspots": a few gaussian bumps per city, deterministic ── */
  function hotspots(citySeed) {
    const hs = [];
    for (let i = 0; i < 4; i++) {
      const a = hash2(citySeed, i, 7) * Math.PI * 2;
      const r = 0.006 + hash2(citySeed, i, 8) * 0.014;      // ~0.7–2.2 km off centre
      hs.push({
        lat: Math.sin(a) * r,
        lng: Math.cos(a) * r,
        amp: 0.28 + hash2(citySeed, i, 9) * 0.35,           // strength
        rad: 0.0035 + hash2(citySeed, i, 10) * 0.005,       // radius
      });
    }
    return hs;
  }

  /* ── per-cell safety factors, all 0..1 ──
     lighting, traffic, business: smooth noise;  crime: noise + hotspots */
  function factors(lat, lng, city) {
    const [ix, iy] = cellKey(lat, lng);
    const s = city.seed;
    // smooth-ish noise: average the 4 nearest cells a touch
    const light = 0.25 + 0.65 * hash2(ix, iy, s + 1);
    const traffic = 0.15 + 0.75 * hash2(ix, iy, s + 2);
    const business = 0.1 + 0.8 * hash2(ix, iy, s + 3);

    let crime = hash2(ix, iy, s + 4) * 0.3;
    for (const h of city.hotspots) {
      const d = Math.hypot(lat - (city.center[0] + h.lat), lng - (city.center[1] + h.lng));
      crime += h.amp * Math.exp(-(d * d) / (h.rad * h.rad));
    }
    crime = Math.min(1, crime);
    return { light, traffic, business, crime };
  }

  /* ── safe havens: try real POIs via Overpass; fall back to synthetic ── */
  const HAVEN_TYPES = {
    police:     { icon: "🚓", label: "Police" },
    hospital:   { icon: "🏥", label: "Hospital" },
    pharmacy:   { icon: "💊", label: "Pharmacy" },
    convenience:{ icon: "🏪", label: "Open late" },
    fuel:       { icon: "⛽", label: "24h fuel" },
  };

  function syntheticHavens(city) {
    const out = [];
    const types = Object.keys(HAVEN_TYPES);
    for (let i = 0; i < 14; i++) {
      const a = hash2(city.seed, i, 21) * Math.PI * 2;
      const r = 0.004 + hash2(city.seed, i, 22) * 0.018;
      out.push({
        lat: city.center[0] + Math.sin(a) * r,
        lng: city.center[1] + Math.cos(a) * r,
        type: types[Math.floor(hash2(city.seed, i, 23) * types.length)],
        name: null,
      });
    }
    return out;
  }

  const OVERPASS_MIRRORS = [
    "https://overpass-api.de/api/interpreter",
    "https://overpass.kumi.systems/api/interpreter",
  ];

  async function fetchHavens(city, bounds) {
    const q = `[out:json][timeout:8];(
      node[amenity~"police|hospital|pharmacy|fuel"](${bounds.join(",")});
      node[shop~"convenience"](${bounds.join(",")});
    );out 40;`;
    let j = null;
    for (const mirror of OVERPASS_MIRRORS) {
      try {
        const res = await fetch(mirror + "?data=" + encodeURIComponent(q),
          { signal: AbortSignal.timeout ? AbortSignal.timeout(10000) : undefined });
        if (res.ok) { j = await res.json(); break; }
      } catch (e) { /* try next mirror */ }
    }
    if (!j) throw new Error("all overpass mirrors failed");
    const out = [];
    for (const el of j.elements || []) {
      const t = el.tags || {};
      const type = t.amenity === "police" ? "police"
                 : t.amenity === "hospital" ? "hospital"
                 : t.amenity === "pharmacy" ? "pharmacy"
                 : t.amenity === "fuel" ? "fuel" : "convenience";
      out.push({ lat: el.lat, lng: el.lon, type, name: t.name || null });
    }
    return out.length ? out.slice(0, 40) : syntheticHavens(city);
  }

  /* ── seeded community reports so the map never looks empty ── */
  const SEED_REPORTS = [
    { cat: "poor_lighting", icon: "🔦", label: "Poorly lit",        dLat:  0.0031, dLng: -0.0042 },
    { cat: "harassment",    icon: "⚠️", label: "Harassment reported", dLat: -0.0022, dLng:  0.0031 },
    { cat: "feels_safe",    icon: "💚", label: "Feels safe",        dLat:  0.0012, dLng:  0.0052 },
    { cat: "isolated",      icon: "🌳", label: "Isolated stretch",  dLat: -0.0040, dLng: -0.0018 },
    { cat: "busy_night",    icon: "🧑‍🤝‍🧑", label: "Busy at night",  dLat:  0.0048, dLng:  0.0014 },
    { cat: "poor_lighting", icon: "🔦", label: "Poorly lit",        dLat: -0.0010, dLng: -0.0055 },
  ];

  function seedReports(city) {
    return SEED_REPORTS.map((r, i) => ({
      id: "seed-" + i,
      lat: city.center[0] + r.dLat * (0.8 + hash2(city.seed, i, 31) * 0.6),
      lng: city.center[1] + r.dLng * (0.8 + hash2(city.seed, i, 32) * 0.6),
      cat: r.cat, icon: r.icon, label: r.label, note: "", seed: true,
      ts: Date.now() - (i + 1) * 86400000 * 3,
    }));
  }

  const REPORT_DELTA = {
    poor_lighting: -14, harassment: -22, isolated: -12,
    feels_safe: +12, busy_night: +8, open_late: +6,
  };

  /* init a city object with its hotspots baked in */
  function city(key) {
    const c = { ...CITIES[key], key };
    c.hotspots = hotspots(c.seed);
    return c;
  }

  return { CELL, CITIES, HAVEN_TYPES, REPORT_DELTA, factors, city, fetchHavens, syntheticHavens, seedReports, hash2 };
})();
