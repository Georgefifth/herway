/* routing.js — real foot routes via the public OSRM demo server,
   with an offline fallback that synthesizes plausible alternatives. */
"use strict";

const Routing = (() => {

  const OSRM = "https://router.project-osrm.org/route/v1/foot/";

  /* returns [{coords:[[lat,lng],...], label}] — real road geometry when online */
  async function getRoutes(from, to) {
    const url = `${OSRM}${from[1]},${from[0]};${to[1]},${to[0]}` +
      `?overview=full&geometries=geojson&alternatives=3&steps=false&continue_straight=true`;
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout ? AbortSignal.timeout(9000) : undefined });
      if (!res.ok) throw new Error("osrm " + res.status);
      const j = await res.json();
      if (!j.routes || !j.routes.length) throw new Error("no routes");
      return j.routes.slice(0, 3).map((r, i) => ({
        coords: r.geometry.coordinates.map(c => [c[1], c[0]]), // lon,lat → lat,lng
        real: true,
        osrmDuration: r.duration, osrmDistance: r.distance,
      }));
    } catch (e) {
      console.warn("OSRM unavailable, using fallback routes:", e.message);
      return fallbackRoutes(from, to);
    }
  }

  /* offline fallback: direct + two bowed variants so the demo still works */
  function fallbackRoutes(from, to) {
    const mk = (bend) => {
      const pts = [];
      const dx = to[0] - from[0], dy = to[1] - from[1];
      const nx = -dy, ny = dx; // normal
      for (let i = 0; i <= 24; i++) {
        const t = i / 24;
        const b = Math.sin(t * Math.PI) * bend;
        pts.push([from[0] + dx * t + nx * b, from[1] + dy * t + ny * b]);
      }
      return pts;
    };
    return [
      { coords: mk(0),        real: false },
      { coords: mk(0.0035),   real: false },
      { coords: mk(-0.0035),  real: false },
    ];
  }

  return { getRoutes };
})();
