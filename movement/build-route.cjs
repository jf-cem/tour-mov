'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { createRoute } = require('./route-core.js');
const source = require('../nodes.json');
const data = {
  schema: 'cem-route-1', id: 'benfica-tour-pano', version: 'provisional-1', provisional: true,
  provenance: 'Polilinha das coordenadas de nodes.json; não é levantamento pedonal validado.',
  geometry: { type: 'LineString', coordinates: source.nodes.map(n => [n.lng, n.lat]) },
  panoramas: source.nodes.map((n, vertexIndex) => ({ id: n.id, title: n.title, vertexIndex }))
};
const route = createRoute(data);
const report = {
  schema: 'cem-route-report-1', routeId: route.id, routeVersion: route.version, provisional: true,
  totalMeters: route.total,
  panoramas: route.panoramas.map(p => ({ id: p.id, title: p.title, alongMeters: p.along })),
  segments: route.panoramas.slice(1).map((p, i) => ({ from: route.panoramas[i].id, to: p.id,
    meters: p.along - route.panoramas[i].along, shorterThan5Meters: p.along - route.panoramas[i].along < 5 })),
  boundaries: route.boundaries.map(b => ({ from: b.from, to: b.to, alongMeters: b.along,
    marginMeters: b.margin, source: b.source })),
  warning: 'Distâncias calculadas entre coordenadas atuais. Não comprovam posição física ou curvas reais.'
};
// Explicit generation only. Once the route is surveyed, edit/version route.json instead of regenerating it.
for (const [name, value] of [['route.json', data], ['route-report.json', report]]) {
  const target = path.join(__dirname, '..', name);
  if (fs.existsSync(target) && JSON.parse(fs.readFileSync(target, 'utf8')).provisional !== true) {
    throw new Error('Recusado substituir um percurso validado: ' + target);
  }
}
fs.writeFileSync(path.join(__dirname, '..', 'route.json'), JSON.stringify(data, null, 2) + '\n');
fs.writeFileSync(path.join(__dirname, '..', 'route-report.json'), JSON.stringify(report, null, 2) + '\n');
console.log(`Percurso provisório: ${route.total.toFixed(2)} m; ${report.segments.filter(s => s.shorterThan5Meters).length} intervalos inferiores a 5 m.`);
