// lib/dispatch-checkpoints-selfcheck.mjs — runnable check for lib/dispatch-checkpoints.mjs.
//   node lib/dispatch-checkpoints-selfcheck.mjs
import assert from 'node:assert';
import { packingListCheckpointCount, dispatchProgress, DISPATCH_CHECKPOINT_COUNT } from './dispatch-checkpoints.mjs';

function selfcheck() {
  assert.strictEqual(DISPATCH_CHECKPOINT_COUNT, 4, 'checkpoint 1 (Scope Ready) stays reserved this round');

  assert.strictEqual(packingListCheckpointCount({}), 0, 'a bare draft has cleared nothing');
  assert.strictEqual(packingListCheckpointCount({ productionApproved: true }), 1);
  assert.strictEqual(
    packingListCheckpointCount({ productionApproved: true, qcApproved: true, dispatched: true, deliveryAcked: true }),
    4, 'a fully closed list clears all 4 built checkpoints'
  );

  assert.strictEqual(dispatchProgress([]), null, 'a project with no packing lists has nothing to report');

  const lists = [
    { productionApproved: true, qcApproved: true, dispatched: true, deliveryAcked: true },
    {}, // a fresh draft
  ];
  const p = dispatchProgress(lists);
  assert.strictEqual(p.totalCount, 8, '2 lists x 4 checkpoints');
  assert.strictEqual(p.completeCount, 4);
  assert.strictEqual(p.listCount, 2, 'every existing list counts — no draft/staleness exclusion this round');

  console.log('lib/dispatch-checkpoints.mjs self-check: all assertions passed.');
}

selfcheck();
