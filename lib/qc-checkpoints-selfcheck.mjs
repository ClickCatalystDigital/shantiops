// lib/qc-checkpoints-selfcheck.mjs — runnable check for lib/qc-checkpoints.mjs.
//   node lib/qc-checkpoints-selfcheck.mjs
import assert from 'node:assert';
import { applicableCheckpoints, checkpointComplete, checkpointSummary, checkpointSummaryFromDetail } from './qc-checkpoints.mjs';

function selfcheck() {
  // --- applicability follows the real MODEL_CONFIG, never a flat 5 ---
  assert.deepStrictEqual(applicableCheckpoints('SF', 0), ['header', 'form3a', 'form4a'], 'no mountings, bought-out excluded');
  assert.deepStrictEqual(applicableCheckpoints('SF', 3), ['header', 'form3a', 'form4a', 'boughtout'], 'presence of mountings adds the checkpoint regardless of model');
  assert.deepStrictEqual(applicableCheckpoints('SIB', 2), ['header', 'form3a', 'form4a', 'boughtout'], 'SIB files IVA (corrected — was wrongly assumed absent earlier)');
  assert.deepStrictEqual(applicableCheckpoints('PRS', 5), ['header', 'form4a', 'boughtout'], 'PRS has no 3A at all');
  assert.deepStrictEqual(applicableCheckpoints('HEADERS', 0), ['header'], 'HEADERS files III+IIIH — no 3A/4A in the core 4 concepts');
  assert.deepStrictEqual(applicableCheckpoints('UNKNOWN_MODEL', 0), ['header', 'form3a', 'form4a'], 'unlisted model falls back to DEFAULT_FORMS');

  // --- "form exists" never counts as "form complete" ---
  assert.strictEqual(checkpointComplete('form3a', { iiiaGroupCount: 0, iiiaPartsAllLinked: true }), false, '0 groups = not complete, per the firm rule');
  assert.strictEqual(checkpointComplete('form3a', { iiiaGroupCount: 2, iiiaPartsAllLinked: false }), false);
  assert.strictEqual(checkpointComplete('form3a', { iiiaGroupCount: 2, iiiaPartsAllLinked: true }), true);
  assert.strictEqual(checkpointComplete('form4a', { ivaPartCount: 0, ivaPartsAllLinked: true }), false, 'zero parts is never complete, matches the existing PDF gate');
  assert.strictEqual(checkpointComplete('form4a', { ivaPartCount: 5, ivaPartsAllLinked: true }), true);
  assert.strictEqual(checkpointComplete('boughtout', { mountingCount: 0, mountingsAllLinked: true }), false);
  assert.strictEqual(checkpointComplete('boughtout', { mountingCount: 4, mountingsAllLinked: true }), true);
  assert.strictEqual(checkpointComplete('header', { headerValues: { a: 'x', b: '' } }), false, 'blank required field');
  assert.strictEqual(checkpointComplete('header', { headerValues: {} }), false, 'missing required field');

  // --- document-level summary ---
  const pr = checkpointSummary('PRS', { headerValues: fullHeader(), ivaPartCount: 3, ivaPartsAllLinked: true, mountingCount: 0 });
  assert.deepStrictEqual(pr.applicable, ['header', 'form4a']);
  assert.strictEqual(pr.completeCount, 2);
  assert.strictEqual(pr.allComplete, true);

  const sf = checkpointSummary('SF', { headerValues: fullHeader(), iiiaGroupCount: 0, ivaPartCount: 3, ivaPartsAllLinked: true, mountingCount: 2, mountingsAllLinked: false });
  assert.strictEqual(sf.totalCount, 4);
  assert.strictEqual(sf.completeCount, 2, 'header + form4a only — 3a has 0 groups, bought-out has an unlinked mounting');
  assert.strictEqual(sf.allComplete, false);

  // --- checkpointSummaryFromDetail: derives the identical summary from a single already-fetched
  // parts array (real shape: one parts array, some rows tagged with iiia_group_id, not the split
  // iiiaParts/ivaParts arrays checkpointSummary's own caller above builds by hand) ---
  const doc = { series: 'SF', ...fullHeader() };
  const parts = [
    { iiia_group_id: 1, test_certificate_id: 5 },   // in a 3A group, linked
    { iiia_group_id: null, test_certificate_id: 7 }, // plain 4A part, linked
    { iiia_group_id: null, test_certificate_id: null }, // plain 4A part, unlinked
  ];
  const mountings = [{ test_certificate_id: 9 }];
  const groups = [{ id: 1 }];
  const partial = checkpointSummaryFromDetail(doc, parts, mountings, groups);
  assert.strictEqual(partial.totalCount, 4, 'SF + mountings present = header/form3a/form4a/boughtout');
  assert.strictEqual(partial.completeCount, 3, 'header + form3a + boughtout complete; form4a incomplete (one unlinked part)');
  assert.strictEqual(partial.allComplete, false);

  const complete = checkpointSummaryFromDetail(
    doc,
    [{ iiia_group_id: 1, test_certificate_id: 5 }, { iiia_group_id: null, test_certificate_id: 7 }],
    mountings, groups);
  assert.strictEqual(complete.allComplete, true, 'every part (3A-grouped or plain) linked, mounting linked, header complete');

  console.log('lib/qc-checkpoints.mjs self-check: all assertions passed.');
}

function fullHeader() {
  // A minimal complete header — real required keys come from QC_HEADER_FIELDS at import time, so
  // fetch them dynamically rather than hardcoding a list that could drift out of sync.
  const keys = [
    'company', 'makers_no', 'year_of_make', 'design_pressure', 'hydro_test_pressure', 'hydro_test_date',
    'working_pressure', 'boiler_type', 'length_overall', 'internal_diameter', 'heating_surface',
    'evaporation_capacity', 'steam_temp', 'doc_id',
  ];
  return Object.fromEntries(keys.map(k => [k, 'x']));
}

selfcheck();
