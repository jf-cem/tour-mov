'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const geo = require('../../geo.js');
const { createRoute, createSelector } = require('../route-core.js');
const { compare, createEngine, metrics } = require('../replay-core.js');
const data = require('../../route.json');
const nodes = require('../../nodes.json').nodes;
const route = createRoute(data);
let checks = 0;
function test(name, fn) { fn(); checks++; console.log('PASS: ' + name); }
const origin = { lat: 38.75, lng: -9.2 };
function straight(lengths = [0, 2.5, 5]) {
  const points = lengths.map(m => geo.destination(origin, m, 90));
  return createRoute({ schema: 'cem-route-1', id: 'test', version: '1', provisional: true,
    geometry: { type: 'LineString', coordinates: points.map(p => [p.lng, p.lat]) },
    panoramas: points.map((_, i) => ({ id: 'p' + i, vertexIndex: i })) });
}
const line = straight();
test('15 panoramas e sete intervalos curtos preservados', () => {
  assert.equal(route.panoramas.length, 15);
  assert.deepEqual(route.panoramas.map(p => p.id), nodes.map(n => n.id));
  assert.equal(route.panoramas.slice(1).filter((p, i) => p.along - route.panoramas[i].along < 5).length, 7);
  assert.ok(Math.abs(route.total - 84.1713) < .001);
});
test('projeção e distância acumulada nos vértices', () => {
  route.points.forEach((p, i) => assert.ok(Math.abs(route.project(p)[0].along - route.cumulative[i]) < .001));
  assert.ok(Math.abs(line.project(line.position(1.7))[0].along - 1.7) < .001);
  assert.ok(line.project(geo.destination(origin, 50, 0))[0].offset > 49);
});
test('fronteiras proporcionais e troca num intervalo de 2,5 m', () => {
  assert.ok(Math.abs(line.boundaries[0].along - 1.25) < .001);
  assert.ok(Math.abs(line.boundaries[0].margin - .375) < .001);
  const selector = createSelector(line, { startId: 'p0' });
  assert.equal(selector.update({ along: 2.2, uncertainty: .1, stamp: 1 }).reason, 'confirming');
  assert.equal(selector.update({ along: 2.2, uncertainty: .1, stamp: 2 }).id, 'p1');
  selector.update({ along: .1, uncertainty: .1, stamp: 3 });
  assert.equal(selector.update({ along: .1, uncertainty: .1, stamp: 4 }).id, 'p0');
});
test('incerteza de 5 m não identifica panoramas separados por 2,5 m', () => {
  const selector = createSelector(line, { startId: 'p0' });
  for (let stamp = 1; stamp < 10; stamp++) {
    const result = selector.update({ along: 2.5, uncertainty: 5, stamp });
    assert.equal(result.id, 'p0'); assert.equal(result.reason, 'ambiguous-panorama');
  }
});
test('amostra repetida não confirma a troca', () => {
  const selector = createSelector(line, { startId: 'p0' });
  selector.update({ along: 2.2, uncertainty: .1, stamp: 1 });
  assert.equal(selector.update({ along: 2.2, uncertainty: .1, stamp: 1 }).id, 'p0');
  assert.equal(selector.update({ along: 2.2, uncertainty: .1, stamp: 2 }).id, 'p0');
  assert.equal(selector.update({ along: 2.2, uncertainty: .1, stamp: 3 }).id, 'p1');
});
test('início intermédio, salto justificado e suspensão', () => {
  const selector = createSelector(route, { confirmations: 1 });
  const middle = route.panoramas[8];
  assert.equal(selector.update({ along: middle.along, uncertainty: .05, stamp: 1 }).id, middle.id);
  assert.equal(selector.update({ along: route.total, uncertainty: .05, stamp: 2 }).id, route.panoramas.at(-1).id);
  assert.equal(selector.update({ along: 0, uncertainty: 0, stamp: 3, suspended: true }).id, route.panoramas.at(-1).id);
});
test('geometria inválida e fronteira fora do intervalo rejeitadas', () => {
  const invalid = structuredClone(data); invalid.geometry.coordinates[0][0] = 999;
  assert.throws(() => createRoute(invalid));
  const boundary = structuredClone(data);
  boundary.boundaries = route.boundaries.map(b => ({ from: b.from, to: b.to, alongMeters: b.along }));
  boundary.boundaries[0].alongMeters = -1;
  assert.throws(() => createRoute(boundary));
  const duplicate = structuredClone(data); duplicate.panoramas[1].id = duplicate.panoramas[0].id;
  assert.throws(() => createRoute(duplicate));
});
function gps(t, along, accuracy = .1, stamp = t) { return { type: 'gps', t, stamp, accuracy, ...route.position(along) }; }
function session(events) { return { schema: 'cem-pano-session-1', routeId: route.id, routeVersion: route.version,
  referenceKind: 'synthetic', events }; }
const initial = route.panoramas[4].along;
const stationary = session([gps(0, initial), gps(1000, initial),
  ...Array.from({ length: 12 }, (_, i) => [
    { type: 'activity', t: 2000 + i * 1000, activity: 'stationary' },
    gps(2000 + i * 1000, initial + 5, 5),
    { type: 'reference', t: 2000 + i * 1000, expectedId: route.panoramas[4].id }
  ]).flat()]);
test('replay expõe falsas trocas com erro persistente e atividade reduz-as', () => {
  const result = compare(stationary, data, nodes);
  assert.ok(result.results.gps.metrics.stationaryTransitions > 0);
  assert.equal(result.results['gps-activity'].metrics.stationaryTransitions, 0);
  assert.equal(result.results['route-activity'].metrics.stationaryTransitions, 0);
});
test('marcadores nunca corrigem o estimador', () => {
  const original = compare(stationary, data, nodes);
  const changed = structuredClone(stationary);
  changed.events.filter(e => e.type === 'reference').forEach(e => { e.expectedId = nodes.at(-1).id; });
  const altered = compare(changed, data, nodes);
  for (const method of Object.keys(original.results)) {
    assert.deepEqual(original.results[method].trace.map(r => r.state), altered.results[method].trace.map(r => r.state));
  }
});
test('replay determinístico e versão incompatível rejeitada', () => {
  assert.deepEqual(compare(stationary, data, nodes), compare(stationary, data, nodes));
  assert.throws(() => compare({ ...stationary, routeVersion: 'other' }, data, nodes));
  assert.throws(() => compare({ ...stationary, events: [gps(100, initial), gps(0, initial)] }, data, nodes));
});
test('atraso medido apenas em fronteiras, sem confundir inicialização com troca', () => {
  const a = nodes[0].id, b = nodes[1].id;
  const row = (t, id, event = { type: 'gps' }) => ({ t, event, state: { id, activity: 'walking' } });
  const result = metrics([row(0, a), row(1000, a, { type: 'reference', expectedId: a, kind: 'position' }),
    row(2000, a, { type: 'reference', expectedId: b, kind: 'boundary' }), row(2500, b)], route);
  assert.equal(result.transitionDelays.length, 1);
  assert.equal(result.transitionDelays[0].delayMs, 500);
  assert.equal(result.referenceMismatches, 1);
});
test('dados antigos, saída do percurso e ausência de passos não inventam deslocação', () => {
  const engine = createEngine('route-activity', nodes, route);
  engine.update(gps(0, initial)); engine.update(gps(1000, initial));
  const id = engine.snapshot().id;
  assert.equal(engine.update(gps(20000, initial + 20, .1, 1000)).reason, 'gps-invalid-or-old');
  const away = geo.destination(nodes[0], 200, 0);
  assert.equal(engine.update({ type: 'gps', t: 21000, stamp: 21000, accuracy: 1, ...away }).reason, 'outside-route-or-unreachable');
  for (let t = 22000; t < 30000; t += 1000) engine.update({ type: 'step', t });
  assert.equal(engine.snapshot().id, id);
});
test('classificação errada de paragem admite deslocamento GPS informativo', () => {
  const engine = createEngine('gps-activity', nodes, route);
  engine.update(gps(0, 0));
  for (let t = 1000; t <= 4000; t += 1000) {
    engine.update({ type: 'activity', t, activity: 'stationary' });
    engine.update(gps(t, route.panoramas[2].along));
  }
  assert.equal(engine.snapshot().id, route.panoramas[2].id);
});
const fixturePath = path.join(__dirname, 'session-synthetic.json');
fs.writeFileSync(fixturePath, JSON.stringify(stationary, null, 2) + '\n');
console.log(`${checks} cenários passaram; sessão sintética criada em ${fixturePath}.`);
