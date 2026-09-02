// scripts/material-indent-selfcheck.mjs — Material Indent (Feature B) pure-logic checks: the
// header status rollup and the CAS-guarded release math. Plain `node`, no DB.
import assert from 'node:assert/strict';
import { rollupIndentStatus, nextReleaseStatus } from '../lib/indent-status.mjs';

// rollupIndentStatus
assert.equal(rollupIndentStatus([]), 'open');
assert.equal(rollupIndentStatus(['open']), 'open');
assert.equal(rollupIndentStatus(['open', 'open']), 'open');
assert.equal(rollupIndentStatus(['partially_released']), 'partially_released');
assert.equal(rollupIndentStatus(['open', 'partially_released']), 'partially_released');
assert.equal(rollupIndentStatus(['released']), 'released');
assert.equal(rollupIndentStatus(['released', 'released']), 'released');
assert.equal(rollupIndentStatus(['cancelled']), 'cancelled');
assert.equal(rollupIndentStatus(['cancelled', 'cancelled']), 'cancelled');
// mixed released + cancelled: nothing left pending, reads as released (no active work remains)
assert.equal(rollupIndentStatus(['released', 'cancelled']), 'released');
// a still-open item alongside a cancelled one stays open (cancelled excluded from consideration)
assert.equal(rollupIndentStatus(['open', 'cancelled']), 'open');
assert.equal(rollupIndentStatus(['partially_released', 'cancelled']), 'partially_released');
assert.equal(rollupIndentStatus(['released', 'partially_released']), 'partially_released');

// nextReleaseStatus
assert.equal(nextReleaseStatus(10, 0, 10), 'released');       // exact match
assert.equal(nextReleaseStatus(10, 0, 4), 'partially_released'); // under
assert.equal(nextReleaseStatus(10, 4, 6), 'released');         // completes a partial
assert.equal(nextReleaseStatus(10, 4, 3), 'partially_released'); // still partial
assert.equal(nextReleaseStatus(10, 0, 11), null);              // over — rejected
assert.equal(nextReleaseStatus(10, 8, 3), null);               // over, from a partial base
assert.equal(nextReleaseStatus(5, 0, 5.0000000001), 'released'); // float slack tolerated

console.log('material-indent-selfcheck: all assertions passed');
