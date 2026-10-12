'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { compare } = require('./replay-core.js');
const sessionPath = process.argv[2];
if (!sessionPath) throw new Error('Utilização: node movement/replay.cjs sessao.json [resultado.json]');
const result = compare(JSON.parse(fs.readFileSync(sessionPath, 'utf8')), require('../route.json'), require('../nodes.json').nodes);
if (process.argv[3]) fs.writeFileSync(path.resolve(process.argv[3]), JSON.stringify(result, null, 2) + '\n');
console.log(JSON.stringify({ referenceKind: result.referenceKind, provisionalRoute: result.provisionalRoute,
  methods: Object.fromEntries(Object.entries(result.results).map(([method, r]) => [method, r.metrics])),
  limitations: result.limitations }, null, 2));
