(function (root) {
  'use strict';
  const node = typeof module === 'object' && module.exports;
  const geo = node ? require('../geo.js') : root.TourGeo;
  const geometry = node ? require('./route-core.js') : root.TourRouteCore;
  const fusion = node ? require('./fusion-core.js') : root.TourFusion;
  const stepDetector = node ? require('./step-detector.js') : root.TourSteps;
  const METHODS = ['gps', 'gps-activity', 'route-activity', 'route-steps'];
  const PARAMETERS = Object.freeze({ maxAccuracy: 20, maxGpsAgeMs: 10000, activityAgeMs: 2000,
    maxSpeed: 3, offRouteMargin: 3, projectionTieMeters: 1, confirmations: 2 });

  function createEngine(method, nodes, route, options = {}) {
    if (!METHODS.includes(method)) throw new Error('Método desconhecido.');
    if (method === 'route-steps') return fusion.createFusion(route, options);
    const detector = stepDetector.createDetector(options.detectorParams);
    const p = { ...PARAMETERS, ...options.params };
    let legacy = geo.createTracker(nodes, options.startId ?? nodes[0].id);
    let selector = geometry.createSelector(route, { startId: options.startId, confirmations: p.confirmations });
    let state = { id: method === 'route-activity' ? options.startId ?? null : options.startId ?? nodes[0].id,
      along: null, uncertainty: null, reason: 'waiting-gps', activity: 'unknown' };
    let activityAt = -Infinity, activity = 'unknown', lastGpsStamp = -Infinity, acceptedFix = null;
    let stationaryOrigin = null, escapeCount = 0;
    function resetStationary() { stationaryOrigin = null; escapeCount = 0; }
    function update(e) {
      if (e.type === 'anchor') {
        if (!route.panoramas.some(p => p.id === e.id)) throw new Error('Âncora desconhecida.');
        legacy = geo.createTracker(nodes, e.id);
        selector = geometry.createSelector(route, {startId:e.id, confirmations:p.confirmations});
        state = {...state, id:e.id, along:e.along, uncertainty:e.uncertainty, reason:'anchored'};
        acceptedFix = null; resetStationary();
        return snapshot();
      }
      if (e.type === 'motion') {
        const d = detector.add(e);
        return update({type:'activity', t:e.t, activity:d.activity === 'uncertain' ? 'unknown' : d.activity});
      }
      if (e.type === 'routeFix') e = { ...e, type:'gps', ...route.position(Math.max(0, Math.min(route.total, e.along))) };
      const freshActivity = e.t - activityAt <= p.activityAgeMs ? activity : 'unknown';
      state = { ...state, activity: freshActivity };
      if (e.type === 'activity') {
        if (!['stationary', 'walking', 'unknown'].includes(e.activity)) throw new Error('Atividade inválida.');
        if (activity !== e.activity) resetStationary();
        activity = e.activity; activityAt = e.t;
        state.activity = activity;
        return snapshot();
      }
      if (e.type !== 'gps') return snapshot();
      if (!Number.isFinite(e.lat) || !Number.isFinite(e.lng) || Math.abs(e.lat) > 90 || Math.abs(e.lng) > 180 ||
          !Number.isFinite(e.accuracy) || e.accuracy < 0 || e.accuracy > p.maxAccuracy ||
          !Number.isFinite(e.stamp) || e.stamp <= lastGpsStamp || e.stamp > e.t || e.t - e.stamp > p.maxGpsAgeMs) {
        state.reason = 'gps-invalid-or-old';
        if (method === 'route-activity') selector.update({ stamp: e.t, suspended: true });
        return snapshot();
      }
      lastGpsStamp = e.stamp;
      const useActivity = method !== 'gps';
      if (useActivity && freshActivity === 'stationary') {
        if (!stationaryOrigin) stationaryOrigin = acceptedFix || e;
        // A wrong stationary classifier must not permanently veto informative displacement.
        const informative = geo.distance(stationaryOrigin, e) > stationaryOrigin.accuracy + e.accuracy + 2;
        escapeCount = informative ? escapeCount + 1 : 0;
        if (escapeCount < 2 && acceptedFix) {
          state.reason = 'stationary';
          if (method === 'route-activity') selector.update({ stamp: e.t, suspended: true });
          return snapshot();
        }
      } else resetStationary();

      if (method !== 'route-activity') {
        const decision = legacy(e, e.accuracy);
        state = { ...state, id: decision.id, uncertainty: e.accuracy,
          reason: decision.waiting ? 'legacy-waiting' : 'tracking', along: geo.routePosition(e, nodes).along };
        acceptedFix = e;
        return snapshot();
      }
      const candidates = route.project(e).filter(c => {
        if (c.offset > e.accuracy + p.offRouteMargin) return false;
        if (!acceptedFix || state.along === null) return true;
        const travel = p.maxSpeed * (e.stamp - acceptedFix.stamp) / 1000;
        return Math.abs(c.along - state.along) <= travel + acceptedFix.accuracy + e.accuracy;
      });
      let best = candidates[0];
      if (acceptedFix && best) {
        // Continuity breaks geometric ties; never pull an arbitrary outside fix onto the route.
        const nearby = candidates.filter(c => c.offset <= best.offset + p.projectionTieMeters);
        nearby.sort((a, b) => Math.abs(a.along - state.along) - Math.abs(b.along - state.along));
        best = nearby[0];
      }
      const ambiguous = best && candidates.some(c => c.offset <= best.offset + p.projectionTieMeters &&
        Math.abs(c.along - best.along) > Math.max(2, e.accuracy) &&
        (!acceptedFix || Math.abs(c.along - state.along) <= Math.abs(best.along - state.along) + e.accuracy));
      if (!best || ambiguous) {
        selector.update({ stamp: e.t, suspended: true });
        state.reason = ambiguous ? 'ambiguous-segment' : 'outside-route-or-unreachable';
        return snapshot();
      }
      const decision = selector.update({ along: best.along, uncertainty: e.accuracy, stamp: e.t });
      state = { ...state, id: decision.id, along: best.along, segment: best.segment,
        uncertainty: e.accuracy, reason: decision.reason };
      acceptedFix = e;
      return snapshot();
    }
    function snapshot() { return { ...state }; }
    return { update, snapshot };
  }

  function validateSession(session, route) {
    if (session.schema !== 'cem-pano-session-1' || session.routeId !== route.id || session.routeVersion !== route.version ||
        !Array.isArray(session.events) || !['synthetic', 'physical', 'virtual'].includes(session.referenceKind)) {
      throw new Error('Sessão incompatível com o percurso ou referência não identificada.');
    }
    let previous = -Infinity;
    for (const e of session.events) {
      if (!Number.isFinite(e.t) || e.t < previous || !['gps', 'rawGps', 'routeFix', 'anchor', 'direction', 'activity', 'step', 'motion', 'tick', 'reference', 'display'].includes(e.type)) {
        throw new Error('Evento inválido ou fora da ordem temporal.');
      }
      previous = e.t;
      if (e.type === 'reference' && !route.panoramas.some(p => p.id === e.expectedId)) {
        throw new Error('Referência de panorama desconhecida.');
      }
      if (e.type === 'reference' && e.kind !== undefined && !['position', 'boundary'].includes(e.kind)) {
        throw new Error('Tipo de referência desconhecido.');
      }
    }
  }

  function metrics(trace, route) {
    const transitions = [], references = [];
    let previous = null, stationaryTransitions = 0, skippedPanoramas = 0;
    for (const row of trace) {
      if (row.event.type === 'reference') references.push({ t: row.t, kind: row.event.kind ?? 'position',
        expectedId: row.event.expectedId, actualId: row.state.id });
      if (row.state.id !== previous && row.state.id !== null) {
        if (previous !== null) {
          if (row.state.activity === 'stationary') stationaryTransitions++;
          const a = route.panoramas.findIndex(p => p.id === previous), b = route.panoramas.findIndex(p => p.id === row.state.id);
          skippedPanoramas += Math.max(0, Math.abs(a - b) - 1);
        }
        transitions.push({ t: row.t, from: previous, to: row.state.id });
        previous = row.state.id;
      }
    }
    const boundaryReferences = references.filter(r => r.kind === 'boundary');
    const delays = boundaryReferences.map((r, i) => {
      const lo = boundaryReferences[i - 1]?.t ?? -Infinity, hi = boundaryReferences[i + 1]?.t ?? Infinity;
      const matches = transitions.filter(x => x.from !== null && x.to === r.expectedId && x.t > lo && x.t < hi);
      matches.sort((a, b) => Math.abs(a.t - r.t) - Math.abs(b.t - r.t));
      return { referenceTime: r.t, expectedId: r.expectedId, actualId: r.actualId,
        delayMs: matches.length ? matches[0].t - r.t : null };
    });
    return { transitions, stationaryTransitions, skippedPanoramas,
      referenceMismatches: references.filter(r => r.actualId !== r.expectedId).length,
      references: references.length, transitionDelays: delays };
  }

  function compare(session, routeData, nodes, options = {}) {
    const route = geometry.createRoute(routeData);
    validateSession(session, route);
    const results = {};
    for (const method of options.methods ?? METHODS) {
      const engine = createEngine(method, nodes, route, { ...session.engineOptions, ...options });
      // Reference markers are never estimator input or a source of position corrections.
      const trace = session.events.map(event => ({ t: event.t, event,
        state: event.type === 'reference' ? engine.snapshot() : engine.update(event) }));
      results[method] = { metrics: metrics(trace, route), trace };
    }
    return { schema: 'cem-pano-comparison-1', routeId: route.id, routeVersion: route.version,
      referenceKind: session.referenceKind, provisionalRoute: route.provisional,
      parameters: { ...PARAMETERS, ...options.params }, results,
      limitations: ['Comprimento do passo e orçamentos de incerteza são parâmetros experimentais.',
        'route-activity não usa passos; route-steps utiliza deteção de cadência e percurso.',
        'Referências sintéticas e distâncias calculadas não demonstram precisão física.',
        'GPS de referência mantém o seletor legado; a aquisição do replay rejeita timestamps inválidos.'] };
  }
  const api = { METHODS, PARAMETERS, createEngine, compare, validateSession, metrics };
  if (node) module.exports = api; else root.TourReplay = api;
})(typeof window === 'undefined' ? globalThis : window);
