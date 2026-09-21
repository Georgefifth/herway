/* reports.js — crowdsourced spot reports, persisted in localStorage per city */
"use strict";

const Reports = (() => {
  const KEY = "herway.reports.v1";
  let userReports = {};
  try { userReports = JSON.parse(localStorage.getItem(KEY) || "{}"); } catch (e) { userReports = {}; }

  function persist() {
    try { localStorage.setItem(KEY, JSON.stringify(userReports)); } catch (e) {}
  }

  function all(city) {
    const seeds = Data.seedReports(city);
    return seeds.concat(userReports[city.key] || []);
  }

  function add(city, { lat, lng, cat, note }) {
    const catMeta = {
      poor_lighting: { icon: "🔦", label: "Poorly lit" },
      harassment:    { icon: "⚠️", label: "Harassment reported" },
      isolated:      { icon: "🌳", label: "Isolated / deserted" },
      feels_safe:    { icon: "💚", label: "Feels safe" },
      busy_night:    { icon: "🧑‍🤝‍🧑", label: "Busy at night" },
      open_late:     { icon: "🏪", label: "Open late nearby" },
    }[cat] || { icon: "📌", label: cat };

    const r = { id: "u" + Date.now(), lat, lng, cat, note: note || "",
                icon: catMeta.icon, label: catMeta.label, seed: false, ts: Date.now() };
    (userReports[city.key] = userReports[city.key] || []).push(r);
    persist();
    return r;
  }

  function stats(city, hour) {
    const reps = all(city);
    // % of sampled cells in view scoring ≥70 — quick "map health" number
    return {
      reports: reps.length,
      positive: reps.filter(r => (Data.REPORT_DELTA[r.cat] || 0) > 0).length,
      flags: reps.filter(r => (Data.REPORT_DELTA[r.cat] || 0) < 0).length,
      guardians: 1200 + Math.round(Data.hash2(city.seed, hour, 77) * 800),
    };
  }

  return { all, add, stats };
})();
