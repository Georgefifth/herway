/* safety.js — transparent route scoring.
   Score = weighted blend of lighting / foot traffic / open businesses /
   (1 − incident risk). Weights shift with time of day. Community reports
   apply local penalties/bonuses; safe havens add a small bonus. */
"use strict";

const Safety = (() => {

  /* nightness: 1 = deep night, 0 = full day (smooth ramps) */
  function nightness(hour) {
    // day 08–18 → 0 ; night 22–04 → 1 ; ramps between
    const t = ((hour % 24) + 24) % 24;
    const smooth = (a, b, x) => { // smoothstep
      const k = Math.min(1, Math.max(0, (x - a) / (b - a)));
      return k * k * (3 - 2 * k);
    };
    if (t >= 8 && t <= 18) return 0;
    if (t > 18 && t < 22) return smooth(18, 22, t);   // dusk ramp
    if (t >= 22 || t <= 4) return 1;
    return 1 - smooth(4, 8, t);                        // dawn ramp
  }

  /* weights per factor, blended day↔night */
  function weights(hour) {
    const n = nightness(hour);
    const day   = { light: 0.10, traffic: 0.35, open: 0.20, safe: 0.35 };
    const night = { light: 0.40, traffic: 0.15, open: 0.15, safe: 0.30 };
    const mix = {};
    for (const k of Object.keys(day)) mix[k] = day[k] * (1 - n) + night[k] * n;
    return { w: mix, night: n };
  }

  function nearCount(lat, lng, pts, radiusDeg) {
    let c = 0;
    for (const p of pts) {
      if (Math.hypot(p.lat - lat, p.lng - lng) <= radiusDeg) c++;
    }
    return c;
  }

  /* point score 0..100 with factor detail */
  function point(lat, lng, city, hour, reports = []) {
    const f = Data.factors(lat, lng, city);
    const { w } = weights(hour);
    const openLate = f.business * (0.4 + 0.6 * Data.hash2(Math.round(lat / Data.CELL), Math.round(lng / Data.CELL), city.seed + 5));

    let raw = w.light * f.light + w.traffic * f.traffic + w.open * openLate + w.safe * (1 - f.crime);
    // contrast expansion so routes differentiate visibly (raw clusters ~0.5)
    let score = Math.max(0, Math.min(1, (raw - 0.5) * 1.5 + 0.5)) * 100;

    let reportDelta = 0;
    for (const r of reports) {
      if (Math.hypot(r.lat - lat, r.lng - lng) <= 0.0018) { // ~200 m
        reportDelta += Data.REPORT_DELTA[r.cat] || 0;
      }
    }
    score = Math.max(2, Math.min(98, score + reportDelta));
    return {
      score,
      detail: {
        Lighting:  Math.round(f.light * 100),
        FootTraffic: Math.round(f.traffic * 100),
        OpenLate:  Math.round(openLate * 100),
        LowIncidents: Math.round((1 - f.crime) * 100),
      },
      reportDelta: Math.round(reportDelta),
    };
  }

  /* resample a polyline every ~step meters */
  function resample(coords, stepM = 70) {
    const pts = [];
    let carry = 0;
    for (let i = 1; i < coords.length; i++) {
      const [a, b] = [coords[i - 1], coords[i]];
      const d = distM(a, b);
      let t = carry;
      while (t < d) {
        const k = t / d;
        pts.push([a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k]);
        t += stepM;
      }
      carry = t - d;
    }
    if (!pts.length && coords.length) pts.push(coords[0]);
    return pts;
  }

  function distM(a, b) {
    const R = 6371000, r = Math.PI / 180;
    const dLat = (b[0] - a[0]) * r, dLng = (b[1] - a[1]) * r;
    const s = Math.sin(dLat / 2) ** 2 +
      Math.cos(a[0] * r) * Math.cos(b[0] * r) * Math.sin(dLng / 2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(s));
  }

  function routeLength(coords) {
    let m = 0;
    for (let i = 1; i < coords.length; i++) m += distM(coords[i - 1], coords[i]);
    return m;
  }

  /* full route score */
  function route(coords, city, hour, reports = [], havens = []) {
    const samples = resample(coords);
    let sum = 0;
    const acc = { Lighting: 0, FootTraffic: 0, OpenLate: 0, LowIncidents: 0 };
    let reportDelta = 0;
    const hits = [];

    for (const [la, ln] of samples) {
      const p = point(la, ln, city, hour, reports);
      sum += p.score;
      for (const k of Object.keys(acc)) acc[k] += p.detail[k];
      reportDelta += p.reportDelta;
    }
    const n = Math.max(1, samples.length);
    for (const k of Object.keys(acc)) acc[k] = Math.round(acc[k] / n);

    // safe-haven bonus: havens within ~150m of the path
    let havenBonus = 0;
    const seen = new Set();
    for (const [la, ln] of samples.filter((_, i) => i % 3 === 0)) {
      for (const h of havens) {
        if (!seen.has(h) && Math.hypot(h.lat - la, h.lng - ln) <= 0.0014) {
          seen.add(h); havenBonus += 3;
        }
      }
    }
    havenBonus = Math.min(10, havenBonus);

    // reports actually lying on the route (for warning text)
    for (const r of reports) {
      for (const [la, ln] of samples.filter((_, i) => i % 2 === 0)) {
        if (Math.hypot(r.lat - la, r.lng - ln) <= 0.0012) { hits.push(r); break; }
      }
    }

    const score = Math.max(2, Math.min(98, Math.round(sum / n + havenBonus)));
    return {
      score,
      breakdown: acc,
      havenBonus,
      reportDelta: Math.round(reportDelta / n),
      reportsOnRoute: hits,
      lengthM: routeLength(coords),
      night: weights(hour).night,
    };
  }

  function grade(score) {
    if (score >= 70) return { cls: "score-good", word: "Safer", color: "#34d399" };
    if (score >= 45) return { cls: "score-mid",  word: "Caution", color: "#fbbf24" };
    return { cls: "score-bad", word: "Risky", color: "#f87171" };
  }

  function cellColor(score) {
    if (score >= 70) return "#34d399";
    if (score >= 45) return "#fbbf24";
    return "#f87171";
  }

  return { nightness, weights, point, route, resample, routeLength, distM, grade, cellColor };
})();
