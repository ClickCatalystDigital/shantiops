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

  // --- inferCategory: last-resort L x W x T MM THICK/THK fallback (2026-09, PMB harvesting round)
  // — a real transposed-description pattern (description names the use, not the material).
  assert.strictEqual(inferCategory('BODY SHELL MATERIAL', '1250X2500X3.15 MM THICK'), 'plate', 'no keyword, but an unambiguous L x W x T dimension triple');
  assert.strictEqual(inferCategory('BODY SHELL MATERIAL', '720X380X8 MM THICK'), 'plate');
  assert.strictEqual(inferCategory('SHEET', '1250X 2500X4 MM THICK'), 'plate', 'a space before the last number is still matched');
  assert.strictEqual(inferCategory('FLANGES MATERIAL', '1250X2500X6 MM THICK'), 'standard', 'the FLANGE keyword rule is checked first and wins — the fallback never overrides an earlier, more specific match');
  assert.strictEqual(inferCategory('SOME RANDOM PART'), null, 'no dimension triple at all: still uncategorized');

  // --- inferCategory: "TUBE SHEET" is flat plate that tubes pass THROUGH, not a tube — a real
  // recurring transposed-description row (APH sheet, 3 real client files, always
  // "1250X3000X8 MM THICK"). A bare "TUBE"/"TUBES" (a real boiler tube) must still match pipe. ---
  assert.strictEqual(inferCategory('TUBE SHEET MATERIAL', '1250X3000X8 MM THICK'), 'plate', '"TUBE SHEET" is plate stock, not a tube — the TUBE keyword must not fire on this compound');
  assert.strictEqual(inferCategory('BOILER TUBES'), 'pipe', 'a bare TUBE/TUBES (no "SHEET" following) must still match pipe as before');
  assert.strictEqual(inferCategory('SIDE WALL TUBE'), 'pipe', 'same — "TUBE" alone, unrelated word after it');

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

  // --- suggestCategoryFromGroups: plural/singular tolerance (2026-09-13, found stress-testing
  // against SB-1040's real PMB) — the catalog's real "V BELTS" group (bom_category='standard') must
  // still match a real, singular "V' BELT" line item. Before this fix the mismatch fell through to
  // suggestSpellingCorrection, which produced a wrong "did you mean BOLT" for a word that was never
  // a typo. ---
  const beltGroups = [{ name: 'V BELTS', category: 'standard' }];
  assert.strictEqual(suggestCategoryFromGroups("V' BELT", beltGroups), 'standard', 'singular description must match a plural group name');
  assert.strictEqual(suggestCategoryFromGroups('V BELTS', beltGroups), 'standard', 'exact plural match unaffected');
  const singularGroups = [{ name: 'DOOR', category: 'standard' }];
  assert.strictEqual(suggestCategoryFromGroups('FIRE DOORS', singularGroups), 'standard', 'plural description must match a singular group name');

  // --- suggestSpellingCorrection: a real, unrelated word one edit away from a canonical keyword
  // must never be "corrected" once suggestCategoryFromGroups already resolved it via the plural fix
  // above — this is the actual end-to-end guarantee, not just the isolated function's own behavior.
  const belt = suggestSpellingCorrection("V' BELT");
  assert.strictEqual(belt?.suggestedWord, 'BOLT', 'in isolation this function still has no idea BELT is a real word — that\'s why it must only ever run after suggestCategoryFromGroups, never before or instead of it');

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
