import assert from 'node:assert';
import { extraSeriesFromNames, docSeries } from './qc-extra-series.mjs';

assert.deepEqual(extraSeriesFromNames(['Boiler', 'Prs', 'Ibr Steam Header']), ['HEADERS', 'PRS']);
assert.deepEqual(extraSeriesFromNames(['Steam Pipe Line - 100nb (upto Header)', 'STEAM PIPE LINE BOILER TO PRS']), ['PRS']);
assert.deepEqual(extraSeriesFromNames(['Boiler', 'SDC', null]), []);
assert.equal(docSeries({ series: 'PRS' }, { series: 'CF' }), 'PRS');
assert.equal(docSeries({ series: 'SF' }, { series: 'CF' }), 'CF');
assert.equal(docSeries({ series: 'SIB' }, { series: 'CF' }), 'SIB');
console.log('qc-extra-series ok');
