// scripts/selfcheck-qc-pdf-pagination.mjs — runnable check for the QC folder PDF's dynamic
// page-numbering math (lib/qc-folder-pdf.js's computeRanges + the joint letter/Form III convergence
// loop). Mirrors the real algorithm by hand against a MOCKED renderSection (no @react-pdf/renderer,
// no R2, no DB) — same "copy the pure logic, keep in lockstep" idiom as scripts/selfcheck-named-parts.mjs,
// needed here because the real function needs live test_certificates/R2 data to actually render.
//   node scripts/selfcheck-qc-pdf-pagination.mjs
import assert from 'node:assert/strict';

function pageRangeLabel(range) {
  if (!range) return '';
  return range.start === range.end ? ` (Page ${range.start})` : ` (Page ${range.start} to ${range.end})`;
}

// Mirrors renderQcFolderPdf's computeRanges + convergence loop. `mockRender(kind, pageRanges)`
// stands in for renderSection — returns a page count for 'letter' or 'iii' given the ranges baked
// into that render, so a test can simulate "adding page-number text grows this section by 1 page."
async function runPagination({ formSections, mountingsPageCount, certPageCount, mockRender }) {
  const iiiSection = formSections.find(sec => sec.key === 'III');

  function computeRanges(letterPageCount) {
    let cursor = 1 + letterPageCount;
    const ranges = {};
    for (const sec of formSections) {
      if (!sec.pageCount) continue;
      ranges[sec.key] = { start: cursor, end: cursor + sec.pageCount - 1 };
      cursor += sec.pageCount;
    }
    if (mountingsPageCount) {
      ranges.mountings = { start: cursor, end: cursor + mountingsPageCount - 1 };
      cursor += mountingsPageCount;
    }
    if (certPageCount) ranges.certificates = { start: cursor, end: cursor + certPageCount - 1 };
    return ranges;
  }

  let letterPageCount = mockRender('letter', null);
  let iterations = 0;
  let letterPageCountFinal;
  for (let i = 0; i < 5; i++) {
    iterations++;
    const pageRanges = computeRanges(letterPageCount);
    const letterRendered = mockRender('letter', pageRanges);

    let iiiChanged = false;
    if (iiiSection?.pageCount && pageRanges.mountings) {
      const iiiRendered = mockRender('iii', pageRanges.mountings);
      if (iiiRendered !== iiiSection.pageCount) {
        iiiSection.pageCount = iiiRendered;
        iiiChanged = true;
      }
    }

    const letterChanged = letterRendered !== letterPageCount;
    letterPageCount = letterRendered;
    letterPageCountFinal = letterRendered;
    if (!letterChanged && !iiiChanged) break;
  }

  return { pageRanges: computeRanges(letterPageCountFinal), iterations };
}

// ---- Test 1: stable case — nothing ever changes size, converges in 1 iteration ----
{
  const formSections = [{ key: 'II1', pageCount: 1 }, { key: 'III', pageCount: 1 }, { key: 'IVA', pageCount: 3 }];
  const { pageRanges, iterations } = await runPagination({
    formSections, mountingsPageCount: 2, certPageCount: 5,
    mockRender: () => 1, // letter always 1 page; III (mocked via same fn) also returns 1
  });
  assert.equal(iterations, 1, 'a document with no size changes must converge on the first pass');
  assert.deepEqual(pageRanges.II1, { start: 2, end: 2 }, 'Form II(1) starts right after the 1-page letter');
  assert.deepEqual(pageRanges.III, { start: 3, end: 3 });
  assert.deepEqual(pageRanges.IVA, { start: 4, end: 6 }, 'a 3-page form spans a real range, not a single page');
  assert.deepEqual(pageRanges.mountings, { start: 7, end: 8 });
  assert.deepEqual(pageRanges.certificates, { start: 9, end: 13 });
}

// ---- Test 2: the letter grows to 2 pages once real page-range text is inserted ----
{
  const formSections = [{ key: 'IVA', pageCount: 3 }];
  let letterCalls = 0;
  const { pageRanges, iterations } = await runPagination({
    formSections, mountingsPageCount: 0, certPageCount: 0,
    mockRender: (kind, ranges) => {
      if (kind !== 'letter') return 1;
      letterCalls++;
      return ranges ? 2 : 1; // grows to 2 pages only once real ranges are baked in
    },
  });
  assert.equal(iterations, 2, 'a letter that grows must trigger a second pass, not stop at the stale count');
  assert.deepEqual(pageRanges.IVA, { start: 3, end: 5 }, 'IVA must start after BOTH letter pages (3), not just 1 (2)');
}

// ---- Test 3: Form III itself grows by a page — every later section must shift, not just be silently wrong ----
{
  const formSections = [{ key: 'III', pageCount: 1 }, { key: 'IVA', pageCount: 2 }];
  const { pageRanges, iterations } = await runPagination({
    formSections, mountingsPageCount: 1, certPageCount: 0,
    mockRender: (kind, ranges) => {
      if (kind === 'letter') return 1;
      // III grows from 1 to 2 pages once it's told the mounting list's page number.
      return ranges ? 2 : 1;
    },
  });
  assert.ok(iterations >= 2, 'Form III growing must trigger another pass, not be silently accepted');
  assert.deepEqual(pageRanges.III, { start: 2, end: 3 }, "III's own range must reflect its final 2-page size");
  assert.deepEqual(pageRanges.IVA, { start: 4, end: 5 }, 'IVA must shift by the extra page III grew by');
  assert.deepEqual(pageRanges.mountings, { start: 6, end: 6 }, 'mountings must shift too');
}

// ---- Test 4: a form with zero pages (Form III A, zero groups) never gets a manifest range ----
{
  const formSections = [{ key: 'IIIA', pageCount: 0 }, { key: 'IVA', pageCount: 1 }];
  const { pageRanges } = await runPagination({
    formSections, mountingsPageCount: 0, certPageCount: 0, mockRender: () => 1,
  });
  assert.equal(pageRanges.IIIA, undefined, 'a form with zero rendered pages must not appear in pageRanges at all');
  assert.deepEqual(pageRanges.IVA, { start: 2, end: 2 }, 'IVA must not leave a gap for the zero-page form');
}

// ---- Test 5: a model with no Form III at all (e.g. SIB, which uses Form XVII instead) — the
// III-specific branch of the loop must simply never engage, converging on the letter alone ----
{
  const formSections = [{ key: 'XVII', pageCount: 1 }, { key: 'IIIA', pageCount: 2 }];
  const { pageRanges, iterations } = await runPagination({
    formSections, mountingsPageCount: 1, certPageCount: 0,
    mockRender: () => 1,
  });
  assert.equal(iterations, 1, 'no Form III present must not prevent convergence');
  assert.deepEqual(pageRanges.XVII, { start: 2, end: 2 });
  assert.deepEqual(pageRanges.IIIA, { start: 3, end: 4 });
  assert.deepEqual(pageRanges.mountings, { start: 5, end: 5 });
}

// ---- pageRangeLabel formatting ----
assert.equal(pageRangeLabel({ start: 5, end: 5 }), ' (Page 5)');
assert.equal(pageRangeLabel({ start: 5, end: 9 }), ' (Page 5 to 9)');
assert.equal(pageRangeLabel(undefined), '');

console.log('All QC folder PDF pagination checks passed.');
