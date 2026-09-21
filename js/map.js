/* map.js — Leaflet setup, safety heat grid, route/haven/report rendering */
"use strict";

const MapView = (() => {
  let map, heatLayer, havenLayer, reportLayer, routeLayer;
  let startMarker, endMarker;
  let canvasRenderer;

  function init(center, zoom) {
    map = L.map("map", { zoomControl: false, worldCopyJump: true });
    L.control.zoom({ position: "bottomright" }).addTo(map);
    L.tileLayer("https://services.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}", {
      attribution: 'Esri, HERE, Garmin, &copy; <a href="https://www.openstreetmap.org/copyright">OSM</a> contributors',
      maxZoom: 19, maxNativeZoom: 16,   // data ends at z16; upscale beyond
    }).addTo(map);
    L.tileLayer("https://services.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Reference/MapServer/tile/{z}/{y}/{x}", {
      maxZoom: 19, maxNativeZoom: 16, opacity: 0.9,
    }).addTo(map);
    map.setView(center, zoom);

    canvasRenderer = L.canvas({ padding: 0.4 });
    heatLayer   = L.layerGroup().addTo(map);
    routeLayer  = L.featureGroup().addTo(map);
    havenLayer  = L.layerGroup().addTo(map);
    reportLayer = L.layerGroup().addTo(map);
    return map;
  }

  /* ── safety heat grid over the current viewport ── */
  function drawHeat(city, hour, reports) {
    heatLayer.clearLayers();
    if (map.getZoom() < 12) return; // too coarse zoomed out
    const b = map.getBounds().pad(-0.06);
    const step = Data.CELL;
    let count = 0;
    for (let la = Math.floor(b.getSouth() / step) * step; la < b.getNorth() && count < 600; la += step) {
      for (let ln = Math.floor(b.getWest() / step) * step; ln < b.getEast() && count < 600; ln += step) {
        const clat = la + step / 2, clng = ln + step / 2;
        const s = Safety.point(clat, clng, city, hour, reports).score;
        L.rectangle([[la, ln], [la + step, ln + step]], {
          renderer: canvasRenderer, stroke: false,
          fillColor: Safety.cellColor(s), fillOpacity: 0.14,
        }).addTo(heatLayer);
        count++;
      }
    }
  }

  /* ── routes ── */
  function drawRoutes(routes, selectedIdx, onSelect) {
    routeLayer.clearLayers();
    routes.forEach((r, i) => {
      const g = Safety.grade(r.safety.score);
      const selected = i === selectedIdx;
      const line = L.polyline(r.coords, {
        color: g.color,
        weight: selected ? 7 : 4,
        opacity: selected ? 0.95 : 0.45,
        lineJoin: "round",
      }).addTo(routeLayer);
      line.on("click", () => onSelect(i));
      line.bindTooltip(`${g.word} · ${r.safety.score}/100`, { sticky: true });
      r._line = line;
    });
    if (routes[selectedIdx]) map.fitBounds(routeLayer.getBounds().pad(0.15));
  }

  /* ── markers ── */
  function pinIcon(color, glyph) {
    return L.divIcon({
      className: "",
      html: `<div style="width:26px;height:26px;border-radius:50% 50% 50% 0;transform:rotate(-45deg);
             background:${color};border:2px solid #fff;display:flex;align-items:center;justify-content:center;
             box-shadow:0 2px 8px rgba(0,0,0,.5)">
             <span style="transform:rotate(45deg);font-size:12px">${glyph}</span></div>`,
      iconSize: [26, 26], iconAnchor: [13, 26],
    });
  }

  function setEndpoints(from, to, onDrag) {
    if (startMarker) map.removeLayer(startMarker);
    if (endMarker) map.removeLayer(endMarker);
    if (from) {
      startMarker = L.marker(from, { draggable: true, icon: pinIcon("#67e8f9", "A") })
        .addTo(map).bindPopup("Start");
      startMarker.on("dragend", () => onDrag("from", startMarker.getLatLng()));
    }
    if (to) {
      endMarker = L.marker(to, { draggable: true, icon: pinIcon("#a78bfa", "B") })
        .addTo(map).bindPopup("Destination");
      endMarker.on("dragend", () => onDrag("to", endMarker.getLatLng()));
    }
  }

  function drawHavens(havens) {
    havenLayer.clearLayers();
    for (const h of havens) {
      const t = Data.HAVEN_TYPES[h.type] || { icon: "🛟", label: h.type };
      L.marker([h.lat, h.lng], {
        icon: L.divIcon({ className: "", html: `<div class="haven-icon">${t.icon}</div>`,
                          iconSize: [26, 26], iconAnchor: [13, 13] }),
      }).addTo(havenLayer).bindTooltip(`${t.label}${h.name ? " · " + h.name : ""}`);
    }
  }

  function drawReports(reports) {
    reportLayer.clearLayers();
    for (const r of reports) {
      L.marker([r.lat, r.lng], {
        icon: L.divIcon({ className: "", html: `<div class="report-icon">${r.icon || "📌"}</div>`,
                          iconSize: [22, 22], iconAnchor: [11, 11] }),
      }).addTo(reportLayer)
        .bindTooltip(`<b>${r.label}</b>${r.note ? "<br>" + r.note : ""}<br><i>${r.seed ? "community report" : "your report"}</i>`);
    }
  }

  function toggleLayer(name, on) {
    const layer = { heat: heatLayer, havens: havenLayer, reports: reportLayer }[name];
    if (!layer) return;
    if (on) layer.addTo(map); else map.removeLayer(layer);
  }

  function fitBounds(coords) {
    map.fitBounds(L.latLngBounds(coords), { padding: [40, 40] });
  }

  /* pulsing "you are here" dot */
  let youMarker = null;
  function markYou(latlng) {
    if (youMarker) map.removeLayer(youMarker);
    youMarker = L.marker(latlng, {
      icon: L.divIcon({ className: "", html: `<div class="you-here"></div>`,
                        iconSize: [18, 18], iconAnchor: [9, 9] }),
    }).addTo(map).bindTooltip("You are here");
    map.setView(latlng, Math.max(map.getZoom(), 15));
  }

  return { init, drawHeat, drawRoutes, setEndpoints, drawHavens, drawReports, toggleLayer, fitBounds, markYou,
           get map() { return map; } };
})();
