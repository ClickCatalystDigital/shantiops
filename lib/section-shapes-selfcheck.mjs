// lib/section-shapes-selfcheck.mjs — runnable check for lib/section-shapes.js's category-inference
// logic (no existing selfcheck covered this file before). Mirrors lib/bom-structure-selfcheck.mjs's
// precedent.
//   node lib/section-shapes-selfcheck.mjs
import assert from 'node:assert';
import { inferCategory, suggestCategoryFromGroups, suggestSpellingCorrection } from './section-shapes.js';

function selfcheck() {
  // --- inferCategory: structural shapes, checked against description alone ---
  assert.strictEqual(inferCategory('MS PLATE 10MM THK'), 'plate');
  assert.strictEqual(inferCategory('ISA 50x50x5 ANGLE'), 'angle');
  assert.strictEqual(inferCategory('MS PIPE 25NB'), 'pipe');
  assert.strictEqual(inferCategory('SOME UNKNOWN WIDGET'), null, 'no match -> null, never guessed');

  // --- inferCategory: sizeSpec is also checked (2026-09 fix) — several real rows carry their real
  // shape indicator there, not in the description. ---
  assert.strictEqual(inferCategory('MS SADDLE', 'ISMC 100x50'), 'channel', 'ISMC in size_spec must be found even when absent from description');
  assert.strictEqual(inferCategory('HEADER FOR S.V & AV', '40NB X 250 Lg'), 'pipe', 'nominal-bore size (NB) in size_spec');
  assert.strictEqual(inferCategory('MS SADDLE'), null, 'without sizeSpec, the same description alone has nothing to match');

  // --- inferCategory: real client spelling variants ---
  assert.strictEqual(inferCategory('ASBESTOR ROPE'), 'other', '"ASBESTOR", not "ASBESTOS"');
  assert.strictEqual(inferCategory('TINNER'), 'other', '"TINNER" (missing H), not "THINNER"');
  assert.strictEqual(inferCategory('THINNER'), 'other', 'the correctly-spelled word must still match');
  assert.strictEqual(inferCategory('PAD PALTE FOR SUPPORT'), 'plate', '"PALTE" (letter transposition), not "PLATE"');
  assert.strictEqual(inferCategory('MS PLATE'), 'plate', 'the correctly-spelled word must still match');

  // --- inferCategory: BEARING/BELT/FIRE DOOR deliberately do NOT match here any more (2026-09) —
  // real Item Master data contradicted the old guess (all three are 'standard', not 'other'); left
  // for suggestCategoryFromGroups (below) to answer correctly via the real catalog instead. ---
  assert.strictEqual(inferCategory('BEARINGS'), null, 'BEARING removed from CATEGORY_PATTERNS — real catalog says standard, not other');
  assert.strictEqual(inferCategory('V BELTS'), null, 'BELT removed from CATEGORY_PATTERNS — real catalog says standard, not other');
  assert.strictEqual(inferCategory('FIRE DOOR'), null, 'FIRE DOOR removed from CATEGORY_PATTERNS — real catalog (group "DOOR") says standard, not other');

  // --- suggestCategoryFromGroups: full-containment rule, not a raw word-count threshold — a
  // single-word group ("DOOR") must still match, which is exactly why this exists (real fix for
  // "FIRE DOOR", confirmed live against the actual catalog: group "DOOR" -> standard). ---
  const groups = [
    { name: 'DOOR', category: 'standard' },
    { name: 'BOILER FEED PUMP', category: 'standard' },
    { name: 'BEARINGS', category: 'standard' },
  ];
  assert.strictEqual(suggestCategoryFromGroups('FIRE DOOR', groups), 'standard', 'single-word group name must still match via full containment');
  assert.strictEqual(suggestCategoryFromGroups('BALL BEARINGS', groups), 'standard');
  assert.strictEqual(
    suggestCategoryFromGroups('BOILER SMOKE BOX', groups), null,
    'sharing only ONE word ("boiler") with a multi-word group must NOT match — this is the real false positive found and fixed this round (BOILER SMOKE BOX vs. BOILER FEED PUMP)'
  );
  assert.strictEqual(suggestCategoryFromGroups('SOME UNRELATED ITEM', groups), null);
  assert.strictEqual(suggestCategoryFromGroups('', groups), null, 'blank description has no words to match');
  assert.strictEqual(suggestCategoryFromGroups('FIRE DOOR', []), null, 'no groups at all -> no opinion');

  // --- suggestCategoryFromGroups: ties between equally-specific, disagreeing groups are refused,
  // never guessed — same "ties refused outright" precedent as lib/tc-match.js. ---
  const tiedGroups = [
    { name: 'RED VALVE', category: 'standard' },
    { name: 'RED VALVE', category: 'other' }, // hypothetical: two same-name groups disagreeing
  ];
  assert.strictEqual(suggestCategoryFromGroups('RED VALVE ASSEMBLY', tiedGroups), null, 'a tie on the same word count between disagreeing categories must refuse, not guess');

  // --- suggestCategoryFromGroups: a longer (more specific) match wins over a shorter one that also
  // fits, even when the shorter one is checked first in the array. ---
  const specificityGroups = [
    { name: 'GLASS', category: 'standard' },
    { name: 'GLASS TUBES', category: 'pipe' },
  ];
  assert.strictEqual(
    suggestCategoryFromGroups('GLASS TUBES 1/2" X 12"', specificityGroups), 'pipe',
    'the more specific 2-word group must win over the less specific 1-word one that also fits'
  );

  // --- suggestSpellingCorrection: the "ask the user, then learn" flow (2026-09-13) — a genuinely
  // new typo, not one already hardcoded into inferCategory's own regex. ---
  const tinner = suggestSpellingCorrection('TINNER');
  assert.strictEqual(tinner?.suggestedWord, 'THINNER');
  assert.strictEqual(tinner?.category, 'other');

  // The real motivating case: a transposition costs 2 in plain Levenshtein (PALTE<->PLATE swaps two
  // adjacent letters), not 1 — this is exactly why the threshold isn't flatly 1 for every word.
  const palte = suggestSpellingCorrection('PAD PALTE FOR SUPPORT');
  assert.strictEqual(palte?.suggestedWord, 'PLATE');
  assert.strictEqual(palte?.category, 'plate');

  assert.strictEqual(suggestSpellingCorrection('MS ANGLE 50X50X5'), null, 'an exact keyword match is inferCategory\'s job, never a "suggestion"');
  assert.strictEqual(suggestSpellingCorrection('SOME UNRELATED WORDS HERE'), null, 'nothing close enough -> no guess');
  assert.strictEqual(suggestSpellingCorrection('PIN'), null, 'too short to ever check (< 4 chars)');
  assert.strictEqual(suggestSpellingCorrection(''), null, 'blank description');

  console.log('lib/section-shapes.js self-check: all assertions passed.');
}

selfcheck();
