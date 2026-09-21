/* safewalk.js — "Walk With Me" companion: simulated trip along the chosen
   route, periodic check-ins, hold-to-SOS. Notifications are simulated. */
"use strict";

const SafeWalk = (() => {
  let swMap, walker, routeLine, timer = null, checkTimer = null, countTimer = null;
  let state = null, toastTimer = null;
  const DEMO_TRIP_SECONDS = 90;   // compressed for demo; real build uses GPS

  function toast(msg) {
    const t = document.getElementById("toast");
    t.textContent = msg; t.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.hidden = true, 2600);
  }

  function nearestHavens(pos, havens, n = 3) {
    return [...havens].sort((a, b) =>
      Math.hypot(a.lat - pos[0], a.lng - pos[1]) - Math.hypot(b.lat - pos[0], b.lng - pos[1])
    ).slice(0, n).map(h => ({ ...h, dM: Safety.distM(pos, [h.lat, h.lng]) }));
  }

  /* danger-zone alert while walking */
  function checkDanger(pos, city, hour, reports, havens) {
    const s = Safety.point(pos[0], pos[1], city, hour, reports).score;
    const box = document.getElementById("swDanger");
    if (s < 45) {
      const near = nearestHavens(pos, havens, 1)[0];
      const t = near ? (Data.HAVEN_TYPES[near.type] || { icon: "🛟", label: "safe haven" }) : null;
      box.innerHTML = `<b>⚠ Low-score area ahead.</b> ` +
        (near ? `Nearest ${t.icon} ${t.label.toLowerCase()} is ${near.dM > 950 ? (near.dM / 1000).toFixed(1) + " km" : Math.round(near.dM) + " m"} away — keep walking.` :
                "Stay aware — consider a busier street.");
      box.hidden = false;
      if (!state.warned) { navigator.vibrate?.(150); state.warned = true; }
    } else if (s >= 48) {
      box.hidden = true;
      state.warned = false;
    }
  }

  async function reverseGeocode(lat, lng) {
    const res = await fetch(`https://nominatim.openstreetmap.org/reverse?format=json` +
      `&lat=${lat}&lon=${lng}&zoom=17`, { headers: { "Accept-Language": "en" } });
    const j = await res.json();
    return j.display_name ? j.display_name.split(",").slice(0, 2).join(",") : null;
  }

  function open() {
    document.getElementById("safeWalk").hidden = false;
    if (!swMap) {
      swMap = L.map("swMap", { zoomControl: false, attributionControl: false,
                               dragging: false, scrollWheelZoom: false });
      L.tileLayer("https://services.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}",
        { maxZoom: 19 }).addTo(swMap);
    }
  }

  function start(route, city, hour, reports, havens, onSOS) {
    open();
    stop();

    state = { route, city, hour, reports, havens, i: 0, t0: Date.now(),
              missedCheckins: 0, warned: false };
    const coords = route.coords;
    const total = Safety.routeLength(coords);

    routeLine && swMap.removeLayer(routeLine);
    routeLine = L.polyline(coords, { color: "#a78bfa", weight: 5, opacity: .9 }).addTo(swMap);
    walker && swMap.removeLayer(walker);
    walker = L.marker(coords[0], {
      icon: L.divIcon({ className: "", html: `<div class="walker-icon">🚶‍♀️</div>`,
                        iconSize: [30, 30], iconAnchor: [15, 15] }),
    }).addTo(swMap);
    swMap.fitBounds(routeLine.getBounds(), { padding: [18, 18] });
    document.getElementById("swStatus").textContent = "walking…";
    document.getElementById("swStatus").style.color = "var(--good)";

    const stepMs = 250;
    const totalSteps = DEMO_TRIP_SECONDS * 1000 / stepMs;
    const perStep = (coords.length - 1) / totalSteps;
    let pos = 0;

    timer = setInterval(() => {
      pos = Math.min(coords.length - 1, pos + perStep);
      const i = Math.floor(pos), f = pos - i;
      const a = coords[i], b = coords[Math.min(coords.length - 1, i + 1)];
      const cur = [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f];
      walker.setLatLng(cur);
      swMap.panTo(cur, { animate: true, duration: .2 });
      checkDanger(cur, state.city, state.hour, state.reports, state.havens);

      const done = Safety.routeLength(coords.slice(0, i + 1)) + Safety.distM(a, b) * f;
      const remain = Math.max(0, total - done);
      const etaS = Math.round(remain / total * DEMO_TRIP_SECONDS);
      document.getElementById("swDist").textContent = remain > 950
        ? (remain / 1000).toFixed(1) + " km" : Math.round(remain) + " m";
      const eta = new Date(Date.now() + etaS * 1000);
      document.getElementById("swETA").textContent =
        eta.getHours().toString().padStart(2, "0") + ":" + eta.getMinutes().toString().padStart(2, "0");

      if (pos >= coords.length - 1) arrive();
    }, stepMs);

    scheduleCheckin();
    wireSOS(onSOS);
  }

  function scheduleCheckin() {
    checkTimer = setTimeout(() => {
      const box = document.getElementById("swCheckin");
      box.hidden = false;
      let n = 20;
      const el = document.getElementById("swCountdown");
      el.textContent = n + "s";
      countTimer = setInterval(() => {
        n--;
        el.textContent = n + "s";
        if (n <= 0) {
          clearInterval(countTimer);
          box.hidden = true;
          state.missedCheckins++;
          const s = document.getElementById("swStatus");
          s.textContent = "no response — guardians notified";
          s.style.color = "var(--bad)";
        }
      }, 1000);
    }, 30000);
  }

  function wireSOS(onSOS) {
    const btn = document.getElementById("swSOS"), fill = document.getElementById("swSOSFill");
    let hold = null, pct = 0;
    const down = (e) => {
      e.preventDefault();
      btn.classList.add("armed");
      hold = setInterval(() => {
        pct += 4;
        fill.style.width = pct + "%";
        if (pct >= 100) { up(); onSOS(); }
      }, 50);
    };
    const up = () => { clearInterval(hold); pct = 0; fill.style.width = "0%"; btn.classList.remove("armed"); };
    btn.onpointerdown = down;
    btn.onpointerup = up; btn.onpointerleave = up;
  }

  function arrive() {
    stop();
    const s = document.getElementById("swStatus");
    s.textContent = "arrived safely ✓";
    s.style.color = "var(--good)";
    document.getElementById("swCheckin").hidden = true;
  }

  function stop() {
    clearInterval(timer); clearTimeout(checkTimer); clearInterval(countTimer);
    document.getElementById("swCheckin").hidden = true;
  }

  function close() {
    stop();
    FakeCall.end();
    document.getElementById("safeWalk").hidden = true;
  }

  function showSOS(city, havens) {
    document.getElementById("sosOverlay").hidden = false;
    // nearest havens
    const w = walker ? walker.getLatLng() : { lat: city.center[0], lng: city.center[1] };
    const sorted = nearestHavens([w.lat, w.lng], havens, 3);
    document.getElementById("sosHavens").innerHTML = sorted.map(h => {
      const t = Data.HAVEN_TYPES[h.type] || { icon: "🛟", label: h.type };
      return `<div class="haven"><span style="font-size:1.2rem">${t.icon}</span>
        <div><b>${t.label}${h.name ? " — " + h.name : ""}</b><br>
        <span class="muted">${h.dM > 950 ? (h.dM / 1000).toFixed(1) + " km" : Math.round(h.dM) + " m"} away</span></div></div>`;
    }).join("");
    // speakable location for a dispatcher — reverse geocode, fallback to coords
    const loc = document.getElementById("sosLoc");
    loc.textContent = `📍 ${w.lat.toFixed(5)}, ${w.lng.toFixed(5)}`;
    reverseGeocode(w.lat, w.lng)
      .then(name => { if (name) loc.textContent = `📍 near ${name}`; })
      .catch(() => {});
    document.getElementById("sosNums").innerHTML = (city.emergency || [["112", "Emergency"]])
      .map(([num, label]) => `<a href="tel:${num}" title="${label}">${num}</a>`).join("");
  }

  function init({ onImOk, onSOSCancel }) {
    document.getElementById("swClose").onclick = close;
    document.getElementById("swFakeCall").onclick = () => FakeCall.start();
    document.getElementById("swShare").onclick = async () => {
      const link = "https://herway.live/w/" + Math.random().toString(36).slice(2, 8);
      try { await navigator.clipboard.writeText(link); }
      catch (e) { /* clipboard blocked — still show the link */ }
      toast(`Walk link copied — guardians can follow: ${link} (simulated)`);
    };
    document.getElementById("swImOk").onclick = () => {
      document.getElementById("swCheckin").hidden = true;
      clearInterval(countTimer);
      const s = document.getElementById("swStatus");
      s.textContent = "walking…"; s.style.color = "var(--good)";
      scheduleCheckin();
    };
    document.getElementById("sosCancel").onclick = () => {
      document.getElementById("sosOverlay").hidden = true;
      onSOSCancel && onSOSCancel();
    };
  }

  return { init, start, close, showSOS, isOpen: () => !document.getElementById("safeWalk").hidden };
})();
