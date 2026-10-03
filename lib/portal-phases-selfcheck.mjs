import assert from 'node:assert';
import { stageProgress, phaseFromWork, docDone } from './portal-phases.mjs';

const st = (name, o = {}) => ({ name, start_date: null, end_date: null, qc_sign_by: null, ...o });
assert.deepEqual(stageProgress([]), { total: 0, started: 0, finished: 0, signed: 0 });
const rows = [st('A', { start_date: 'x', end_date: 'y', qc_sign_by: 'q' }), st('B', { start_date: 'x', end_date: 'y' }), st('C'), st('DISPATCH', { start_date: 'x' })];
const sp = stageProgress(rows);
assert.deepEqual(sp, { total: 3, started: 2, finished: 2, signed: 1 }); // DISPATCH left out
assert.equal(phaseFromWork('manufacturing', sp, []).status, 'in_progress');
assert.deepEqual(phaseFromWork('manufacturing', sp, []).progress, { done: 2, total: 3, noun: 'stages' });
assert.equal(phaseFromWork('testing', sp, []).status, 'in_progress');
assert.equal(phaseFromWork('testing', stageProgress([st('A', { qc_sign_by: 'q', end_date: 'y' })]), []).status, 'done');
assert.equal(phaseFromWork('manufacturing', stageProgress([st('A')]), []).status, 'upcoming');
assert.equal(phaseFromWork('manufacturing', stageProgress([]), []), null); // no job card -> caller falls back
assert.equal(phaseFromWork('testing', stageProgress([]), []), null);
assert.equal(phaseFromWork('packing', sp, []), null);
assert.equal(phaseFromWork('documentation', sp, []).status, 'upcoming');
const d1 = { total_parts: 5, linked_parts: 5, customer_visible: 1 }, d2 = { total_parts: 5, linked_parts: 3, customer_visible: 0 };
assert.ok(docDone(d1)); assert.ok(!docDone(d2)); assert.ok(!docDone({ total_parts: 0, linked_parts: 0, customer_visible: 1 }));
assert.equal(phaseFromWork('documentation', sp, [d1]).status, 'done');
assert.equal(phaseFromWork('documentation', sp, [d1, d2]).status, 'in_progress');
assert.deepEqual(phaseFromWork('documentation', sp, [d1, d2]).progress, { done: 1, total: 2, noun: 'documents' });
console.log('portal-phases ok');
