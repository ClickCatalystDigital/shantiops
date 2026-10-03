import assert from 'node:assert';
import { extraSeriesFromNames, docSeries, seriesLabel, mainFirst } from './qc-extra-series.mjs';

assert.deepEqual(extraSeriesFromNames(['Boiler', 'Prs', 'Ibr Steam Header']), ['HEADERS', 'PRS']);
assert.deepEqual(extraSeriesFromNames(['Steam Pipe Line - 100nb (upto Header)', 'STEAM PIPE LINE BOILER TO PRS']), ['PRS']);
assert.deepEqual(extraSeriesFromNames(['Boiler', 'SDC', null]), []);
assert.equal(docSeries({ series: 'PRS' }, { series: 'CF' }), 'PRS');
assert.equal(docSeries({ series: 'SF' }, { series: 'CF' }), 'CF');
assert.equal(docSeries({ series: 'SIB' }, { series: 'CF' }), 'SIB');
assert.equal(seriesLabel('PRS'), 'Pressure Reducing Station');
assert.equal(seriesLabel('CF'), 'Boiler');
assert.deepEqual(mainFirst([{ id: 1, series: 'PRS' }, { id: 2, series: 'CF' }]).map(d => d.id), [2, 1]);
console.log('qc-extra-series ok');
