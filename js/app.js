/* app.js — glue: state, UI wiring, geocoding, report flow, Safe Walk entry */
"use strict";

(() => {
  const $ = (id) => document.getElementById(id);

  const state = {
    city: Data.city("nyc"),
    hour: 22,
    reports: [],
    havens: [],
    routes: [],        // {coords, safety:{...}}
    selected: 0,
    from: null, to: null,
    picking: null,     // 'from' | 'to' | 'report'
    reportCat: null, reportLatLng: null,
  };

  /* ─────────── boot ─────────── */
  const map = MapView.init(state.city.center, state.city.zoom);

  function refreshAll() {
    state.reports = Reports.all(state.city);
    MapView.drawHeat(state.city, state.hour, state.reports);
    MapView.drawHavens(state.havens);
    MapView.drawReports(state.reports);
    renderStats();
    renderReportList();
    if (state.routes.length) rescore();
  }

  async function loadHavens() {
    const b = map.getBounds().pad(0.3);
    try {
      state.havens = await Data.fetchHavens(state.city,
        [b.getSouth(), b.getWest(), b.getNorth(), b.getEast()]);
    } catch (e) {
      state.havens = Data.syntheticHavens(state.city);
    }
    MapView.drawHavens(state.havens);
  }

  /* ─────────── time slider ─────────── */
  const slider = $("timeSlider");
  function applyHour() {
    state.hour = +slider.value;
    $("timeLabel").textContent = String(state.hour).padStart(2, "0") + ":00";
    $("timeIcon").textContent =
      state.hour < 5 ? "🌙" : state.hour < 8 ? "🌅" : state.hour < 18 ? "☀️" : state.hour < 21 ? "🌇" : "🌙";
    MapView.drawHeat(state.city, state.hour, state.reports);
    if (state.routes.length) rescore();
    renderStats();
  }
  slider.addEventListener("input", applyHour);

  /* ─────────── city selector ─────────── */
  $("citySelect").addEventListener("change", async (e) => {
    state.city = Data.city(e.target.value);
    state.routes = []; state.from = state.to = null;
    map.setView(state.city.center, state.city.zoom);
    MapView.setEndpoints(null, null, onEndpointDrag);
    refreshAll();
    loadHavens();
  });

  /* ─────────── endpoints ─────────── */
  function setEndpoint(which, latlng, label) {
    state[which] = latlng;
    $(which + "Input").value = label ||
      `${latlng[0].toFixed(4)}, ${latlng[1].toFixed(4)}`;
    MapView.setEndpoints(state.from, state.to, onEndpointDrag);
  }
  function onEndpointDrag(which, ll) {
    state[which] = [ll.lat, ll.lng];
    $(which + "Input").value = `${ll.lat.toFixed(4)}, ${ll.lng.toFixed(4)}`;
    if (state.routes.length) plan(); // live re-route on drag
  }

  async function geocode(q) {
    const b = map.getBounds();
    const url = `https://nominatim.openstreetmap.org/search?format=json&limit=1` +
      `&viewbox=${b.getWest()},${b.getNorth()},${b.getEast()},${b.getSouth()}` +
      `&q=${encodeURIComponent(q)}`;
    const res = await fetch(url, { headers: { "Accept-Language": "en" } });
    const j = await res.json();
    if (!j.length) throw new Error("not found");
    return [parseFloat(j[0].lat), parseFloat(j[0].lon)];
  }

  async function resolveInput(which) {
    const v = $(which + "Input").value.trim();
    if (!v) return null;
    const m = v.match(/^(-?\d+\.?\d*)\s*,\s*(-?\d+\.?\d*)$/);
    if (m) { const ll = [+m[1], +m[2]]; setEndpoint(which, ll, v); return ll; }
    try {
      const ll = await geocode(v);
      setEndpoint(which, ll, v);
      return ll;
    } catch (e) {
      $(which + "Input").value = "";
      hint(`Couldn't find “${v}” — click 📍 to drop a pin instead.`);
      return null;
    }
  }

  /* pick-on-map mode */
  function startPick(which) {
    state.picking = which;
    $("pickBanner").hidden = false;
    $("pickTarget").textContent = which === "report" ? "the spot to report" : which;
    map.getContainer().style.cursor = "crosshair";
  }
  function endPick() {
    state.picking = null;
    $("pickBanner").hidden = true;
    map.getContainer().style.cursor = "";
  }
  $("fromPick").onclick = () => startPick("from");
  $("toPick").onclick = () => startPick("to");
  $("pickCancel").onclick = endPick;

  map.on("click", (e) => {
    if (!state.picking) return;
    const ll = [e.latlng.lat, e.latlng.lng];
    if (state.picking === "report") {
      state.reportLatLng = ll;
      openModal("modalReport");
    } else {
      setEndpoint(state.picking, ll);
    }
    endPick();
  });

  /* ─────────── routing ─────────── */
  function hint(t) { $("routeHint").textContent = t; }

  async function plan() {
    const from = state.from || await resolveInput("from");
    const to = state.to || await resolveInput("to");
    if (!from || !to) { hint("Set a start and destination first."); return; }

    hint("Routing…");
    const raw = await Routing.getRoutes(from, to);
    state.routes = raw.map(r => ({ coords: r.coords, real: r.real }));
    rescore();
    state.selected = bestIdx();
    renderRoutes();
    MapView.drawRoutes(state.routes, state.selected, selectRoute);
    hint(raw[0] && raw[0].real
      ? "Live road routing via OSRM."
      : "Offline mode — showing synthesized route options.");
  }

  function rescore() {
    for (const r of state.routes)
      r.safety = Safety.route(r.coords, state.city, state.hour, state.reports, state.havens);
    if (state.routes.length) { renderRoutes(); }
    MapView.drawRoutes(state.routes, state.selected, selectRoute);
  }

  function bestIdx() {
    let best = 0;
    state.routes.forEach((r, i) => { if (r.safety.score > state.routes[best].safety.score) best = i; });
    return best;
  }

  function selectRoute(i) {
    state.selected = i;
    renderRoutes();
    MapView.drawRoutes(state.routes, state.selected, selectRoute);
  }

  function renderRoutes() {
    $("routeResults").hidden = false;
    const list = $("routeList");
    list.innerHTML = "";
    const sorted = state.routes.map((r, i) => ({ r, i }))
      .sort((a, b) => b.r.safety.score - a.r.safety.score);
    sorted.forEach(({ r, i }, rank) => {
      const g = Safety.grade(r.safety.score);
      const km = (r.safety.lengthM / 1000).toFixed(2);
      const mins = Math.round(r.safety.lengthM / 84); // ~5 km/h walk
      const el = document.createElement("div");
      el.className = "route-card" + (i === state.selected ? " selected" : "");
      el.innerHTML = `
        <div class="rc-top">
          <span class="rc-name">${rank === 0 ? "★ Safest pick" : "Option " + (rank + 1)}</span>
          <span class="score-pill ${g.cls}">${r.safety.score}</span>
        </div>
        <div class="rc-meta">${g.word} · ${km} km · ~${mins} min walk${r.real ? "" : " · est."}</div>
        ${r.safety.reportsOnRoute.length
          ? `<div class="rc-warn">⚠ ${r.safety.reportsOnRoute.length} community report(s) on this path</div>` : ""}
        ${r.safety.havenBonus ? `<div class="rc-meta">🛟 passes ${r.safety.havenBonus / 3 | 0} safe haven(s)</div>` : ""}`;
      el.onclick = () => selectRoute(i);
      list.appendChild(el);
    });
    renderBreakdown(state.routes[state.selected]);
  }

  function renderBreakdown(route) {
    const box = $("routeBreakdown");
    if (!route) { box.hidden = true; return; }
    box.hidden = false;
    const bk = route.safety.breakdown;
    const names = { Lighting: "Lighting", FootTraffic: "Foot traffic",
                    OpenLate: "Open late", LowIncidents: "Low incidents" };
    box.innerHTML = `<h4>Why this score (transparent)</h4>` + Object.keys(names).map(k => {
      const v = bk[k];
      const color = v >= 70 ? "var(--good)" : v >= 45 ? "var(--mid)" : "var(--bad)";
      return `<div class="bk-row"><label>${names[k]}</label>
        <div class="bk-bar"><i style="width:${v}%;background:${color}"></i></div><b>${v}</b></div>`;
    }).join("") +
    (route.safety.reportDelta ? `<p class="hint">Community reports adjusted this route by ${route.safety.reportDelta > 0 ? "+" : ""}${route.safety.reportDelta} pts.</p>` : "");
  }

  $("btnRoute").onclick = plan;
  $("btnDemo").onclick = () => {
    const [f, t] = state.city.demo;
    setEndpoint("from", f, "Demo start");
    setEndpoint("to", t, "Demo destination");
    plan();
  };
  $("fromInput").addEventListener("keydown", e => { if (e.key === "Enter") resolveInput("from"); });
  $("toInput").addEventListener("keydown", e => { if (e.key === "Enter") resolveInput("to"); });

  /* ─────────── layers ─────────── */
  $("layerHeat").onchange = e => MapView.toggleLayer("heat", e.target.checked);
  $("layerHavens").onchange = e => MapView.toggleLayer("havens", e.target.checked);
  $("layerReports").onchange = e => MapView.toggleLayer("reports", e.target.checked);

  map.on("moveend zoomend", () => MapView.drawHeat(state.city, state.hour, state.reports));

  /* ─────────── reports ─────────── */
  $("btnReport").onclick = () => startPick("report");

  $("reportCats").addEventListener("click", (e) => {
    const btn = e.target.closest("button[data-cat]");
    if (!btn) return;
    [...$("reportCats").children].forEach(b => b.classList.remove("active"));
    btn.classList.add("active");
    state.reportCat = btn.dataset.cat;
    $("reportSubmit").disabled = false;
  });

  $("reportSubmit").onclick = () => {
    if (!state.reportCat || !state.reportLatLng) return;
    Reports.add(state.city, {
      lat: state.reportLatLng[0], lng: state.reportLatLng[1],
      cat: state.reportCat, note: $("reportNote").value.trim(),
    });
    $("reportNote").value = "";
    state.reportCat = null; state.reportLatLng = null;
    $("reportSubmit").disabled = true;
    closeModals();
    refreshAll();
    hint("Report added — nearby scores updated.");
  };

  function renderReportList() {
    const recent = [...state.reports].sort((a, b) => b.ts - a.ts).slice(0, 6);
    $("recentReports").innerHTML = recent.map(r =>
      `<li>${r.icon} <b>${r.label}</b> — ${r.seed ? "community" : "you"} · ${ago(r.ts)}</li>`).join("");
  }
  function ago(ts) {
    const d = Math.floor((Date.now() - ts) / 86400000);
    return d === 0 ? "today" : d === 1 ? "1d ago" : d + "d ago";
  }
  function renderStats() {
    const s = Reports.stats(state.city, state.hour);
    $("reportStats").innerHTML = `
      <div class="stat"><b>${s.reports}</b><span>reports</span></div>
      <div class="stat"><b>${s.guardians.toLocaleString()}</b><span>guardians nearby</span></div>`;
  }

  /* ─────────── modals ─────────── */
  function openModal(id) {
    $("modalBackdrop").hidden = false;
    ["modalReport", "modalHow", "modalLearn"].forEach(m => $(m).hidden = m !== id);
  }
  function closeModals() { $("modalBackdrop").hidden = true; }
  $("modalBackdrop").addEventListener("click", (e) => {
    if (e.target === $("modalBackdrop") || e.target.closest("[data-close]")) closeModals();
  });
  $("btnHow").onclick = () => openModal("modalHow");
  $("btnLearn").onclick = () => openModal("modalLearn");

  /* ─────────── Safe Walk ─────────── */
  SafeWalk.init({ onSOSCancel: () => {} });
  $("btnSOS").onclick = async () => {
    let route = state.routes[state.selected];
    if (!route) {
      const [f, t] = state.city.demo;
      setEndpoint("from", f, "Demo start"); setEndpoint("to", t, "Demo destination");
      const raw = await Routing.getRoutes(f, t);
      route = { coords: raw[0].coords };
      state.routes = raw.map(r => ({ coords: r.coords })); rescore();
    }
    SafeWalk.start(route, state.city, () => SafeWalk.showSOS(state.city, state.havens));
  };
  document.addEventListener("keydown", e => {
    if (e.key === "Escape") { closeModals(); endPick(); }
  });

  /* ─────────── splash + geolocation ─────────── */
  $("splashGo").onclick = () => {
    $("splash").style.display = "none";
    map.invalidateSize();
    if (navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        (pos) => map.setView([pos.coords.latitude, pos.coords.longitude], 15),
        () => {}, { timeout: 3000 });
    }
  };

  /* ─────────── go ─────────── */
  applyHour();
  refreshAll();
  loadHavens();
})();
