// lib/category-learning.js — the DB-touching half of category_word_corrections. suggestSpellingCorrection
// (lib/section-shapes.js) stays pure; this is the one write path every confirmed category pick goes
// through, so a typo fixed once anywhere (import confirm, a manual PATCH, the Resolve Categories
// dialog, or the Release BOM sweep) is remembered for every future import — not just the import route.
import { execute } from './db';
import { suggestSpellingCorrection } from './section-shapes';
import { memoryKeys } from './item-attributes.mjs';

// Whole-description memory: a person's category pick for this wording is reused for the same wording next time.
export async function rememberCategory(description, category, confirmedBy) {
  const alias = memoryKeys({ material_description: description }).alias;
  if (!alias || !category) return;
  await execute('INSERT OR REPLACE INTO category_memory (alias_key, category, confirmed_by) VALUES (?, ?, ?)', [alias, category, confirmedBy]);
}

// A human confirmed `category` for `description`. If that's exactly what the spelling-correction tier
// would have suggested, remember it — same rule the PMB import route already applies at confirm time.
export async function learnCategoryIfConfirmed(description, category, confirmedBy) {
  if (!description || !category) return false;
  await rememberCategory(description, category, confirmedBy);
  const suggestion = suggestSpellingCorrection(description);
  if (!suggestion || suggestion.category !== category) return false;
  await execute(
    'INSERT OR REPLACE INTO category_word_corrections (word, category, confirmed_by) VALUES (?, ?, ?)',
    [suggestion.word.toUpperCase(), category, confirmedBy]);
  return true;
}
