(function (root) {
  'use strict';
  const geo = typeof module === 'object' && module.exports ? require('../geo.js') : root.TourGeo;
  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
  const finite = Number.isFinite;

  function coordinate(c) {
    if (!Array.isArray(c) || !finite(c[0]) || !finite(c[1]) || Math.abs(c[0]) > 180 || Math.abs(c[1]) > 90) {
      throw new Error('Coordenadas inválidas no percurso.');
    }
    return { lng: c[0], lat: c[1] };
  }

  function createRoute(data) {
    if (data.schema !== 'cem-route-1' || !data.id || !data.version || data.geometry?.type !== 'LineString') {
      throw new Error('Formato ou versão do percurso inválidos.');
    }
    const points = data.geometry.coordinates.map(coordinate);
    if (points.length < 2) throw new Error('O percurso precisa de pelo menos dois pontos.');
    const cumulative = [0];
    for (let i = 1; i < points.length; i++) {
      const length = geo.distance(points[i - 1], points[i]);
      if (length < .01) throw new Error('Vértices consecutivos coincidentes.');
      cumulative.push(cumulative[i - 1] + length);
    }
    const total = cumulative.at(-1), ids = new Set();
    const panoramas = data.panoramas.map(p => {
      if (!p.id || ids.has(p.id) || !Number.isInteger(p.vertexIndex) || p.vertexIndex < 0 || p.vertexIndex >= points.length) {
        throw new Error('Referência de panorama inválida.');
      }
      ids.add(p.id);
      return { ...p, along: cumulative[p.vertexIndex] };
    });
    if (panoramas.length < 2 || panoramas.some((p, i) => i && p.along <= panoramas[i - 1].along)) {
      throw new Error('Os panoramas devem seguir a ordem do percurso.');
    }
    const boundaries = panoramas.slice(1).map((p, i) => {
      const explicit = data.boundaries?.[i];
      const along = explicit?.alongMeters ?? (panoramas[i].along + p.along) / 2;
      if (!finite(along) || along <= panoramas[i].along || along >= p.along ||
          explicit && (explicit.from !== panoramas[i].id || explicit.to !== p.id)) {
        throw new Error('Fronteira de panorama inválida.');
      }
      return { from: panoramas[i].id, to: p.id, along, source: explicit ? 'override' : 'midpoint',
        margin: Math.min(.75, (p.along - panoramas[i].along) * .15) };
    });
    if (data.boundaries && data.boundaries.length !== boundaries.length) throw new Error('Número de fronteiras inválido.');

    function position(along) {
      if (!finite(along)) throw new Error('Distância inválida.');
      const bounded = clamp(along, 0, total);
      let segment = 0;
      while (segment < points.length - 2 && cumulative[segment + 1] < bounded) segment++;
      const a = points[segment], b = points[segment + 1];
      const fraction = (bounded - cumulative[segment]) / (cumulative[segment + 1] - cumulative[segment]);
      return { lat: a.lat + (b.lat - a.lat) * fraction, lng: a.lng + (b.lng - a.lng) * fraction, segment };
    }

    // Return every hypothesis. Selection/continuity belongs to the estimator, not this geometry layer.
    function project(position) {
      coordinate([position.lng, position.lat]);
      const scale = Math.cos(points[0].lat * Math.PI / 180), factor = 6371000 * Math.PI / 180;
      return points.slice(0, -1).map((a, segment) => {
        const b = points[segment + 1], dx = (b.lng - a.lng) * scale, dy = b.lat - a.lat;
        const px = (position.lng - a.lng) * scale, py = position.lat - a.lat;
        const fraction = clamp((px * dx + py * dy) / (dx * dx + dy * dy), 0, 1);
        return { segment, along: cumulative[segment] + fraction * (cumulative[segment + 1] - cumulative[segment]),
          offset: Math.hypot(px - fraction * dx, py - fraction * dy) * factor,
          tangentHeading: (Math.atan2(dx, dy) * 180 / Math.PI + 360) % 360 };
      }).sort((a, b) => a.offset - b.offset || a.segment - b.segment);
    }
    function indexAt(along) { return boundaries.filter(b => along > b.along).length; }
    return { id: data.id, version: data.version, provisional: data.provisional === true,
      points, cumulative, panoramas, boundaries, total, position, project, indexAt };
  }

  function createSelector(route, options = {}) {
    const confirmations = options.confirmations ?? 2;
    if (!Number.isInteger(confirmations) || confirmations < 1) throw new Error('Confirmações inválidas.');
    let current = options.startId ?? null, pending = null, count = 0, lastStamp = -Infinity;
    if (current !== null && !route.panoramas.some(p => p.id === current)) throw new Error('Panorama inicial desconhecido.');
    function hold(reason) { pending = null; count = 0; return { id: current, changed: false, reason }; }
    return {
      update({ along, uncertainty, stamp, suspended = false }) {
        if (!finite(stamp) || stamp <= lastStamp) return hold('duplicate-or-old');
        lastStamp = stamp;
        if (suspended || !finite(along) || !finite(uncertainty) || uncertainty < 0 || along < 0 || along > route.total) {
          return hold('position-unavailable');
        }
        // Do not clip uncertainty at the route endpoints: the clamp adds no evidence.
        const low = along - uncertainty, high = along + uncertainty, candidate = route.indexAt(along);
        if (candidate > 0 && low <= route.boundaries[candidate - 1].along + route.boundaries[candidate - 1].margin ||
            candidate < route.panoramas.length - 1 && high >= route.boundaries[candidate].along - route.boundaries[candidate].margin) {
          return hold('ambiguous-panorama');
        }
        const id = route.panoramas[candidate].id;
        if (id === current) return hold('same-panorama');
        if (id === pending) count++; else { pending = id; count = 1; }
        if (count < confirmations) return { id: current, changed: false, reason: 'confirming' };
        current = id;
        pending = null; count = 0;
        return { id: current, changed: true, reason: 'identified' };
      },
      snapshot: () => ({ id: current, pending, count })
    };
  }
  const api = { createRoute, createSelector };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.TourRouteCore = api;
})(typeof window === 'undefined' ? globalThis : window);
