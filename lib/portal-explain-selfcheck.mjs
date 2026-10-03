import assert from 'node:assert';
import { currentSummary, STAGE_EXPLAIN } from './portal-explain.mjs';

const ph = (key, status) => ({ key, label: key, status });
assert.match(currentSummary([ph('order', 'done'), ph('design', 'awaiting_customer')]).title, /approval/);
assert.match(currentSummary([ph('order', 'done'), ph('design', 'done')]).title, /complete/);
assert.equal(currentSummary([ph('order', 'done'), ph('manufacturing', 'in_progress'), ph('testing', 'in_progress')]).title, 'Now: manufacturing · testing');
assert.match(currentSummary([ph('order', 'done'), ph('manufacturing', 'in_progress'), ph('testing', 'in_progress')]).body, /same time/);
assert.equal(currentSummary([ph('order', 'done'), ph('packing', 'in_progress'), ph('pending', 'in_progress')]).title, 'Now: packing'); // pending is a side list
assert.equal(currentSummary([ph('order', 'done'), ph('design', 'upcoming')]).title, 'Next: design');
assert.ok(STAGE_EXPLAIN.pending && STAGE_EXPLAIN.documentation);
console.log('portal-explain ok');
