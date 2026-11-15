// Runs the real calc engine (lib/calc-engine.js) on lib/calc-sets/ibr-1950-shell-boiler.json with its sample inputs and
// compares every result with the value printed in the approved 3000 kg/hr design calculation the set was transcribed
// from (the set's "expected" block). Also checks the set is complete: every name a formula or check uses is an input
// or another formula's output, and every check passes on the sample. node scripts/calc-set-ibr-selfcheck.mjs
import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import { computeAll, runValidations, extractDeps } from '../lib/calc-engine.js';
import { calcSetRows, calcSetSamples } from '../lib/calc-set.mjs';

const set = JSON.parse(readFileSync(new URL('../lib/calc-sets/ibr-1950-shell-boiler.json', import.meta.url), 'utf8'));
const { variables, formulas, validations } = calcSetRows(set);
const names = variables.map((v) => v.name);

// Completeness: no formula or check reads a name the set doesn't define.
for (const f of formulas) {
  const deps = extractDeps(f.versions[0].expr, names);
  assert.ok(deps.every((d) => names.includes(d)), `${f.outputVar} reads an undefined name`);
}
const undefinedIn = (expr) => (expr.match(/[A-Za-z_][A-Za-z0-9_]*/g) || [])
  .filter((t) => !names.includes(t) && !['min', 'max', 'and', 'or', 'sqrt'].includes(t));
for (const c of validations) assert.deepEqual(undefinedIn(c.expr), [], `check "${c.name}" reads an undefined name`);
assert.equal(new Set(names).size, names.length, 'duplicate variable names');

const { values, trace } = computeAll(variables, formulas);
const errors = trace.filter((t) => t.error).map((t) => `${t.formulaName}: ${t.error}`);
assert.deepEqual(errors, [], 'formulas failed');

// Printed values are rounded; the PDF's own arithmetic has small rounding of its own (e.g. shell compensation).
let worst = 0;
for (const [name, want] of Object.entries(set.expected)) {
  const got = values[name];
  const diff = Math.abs(got - want) / Math.abs(want);
  worst = Math.max(worst, diff);
  assert.ok(diff < 0.01, `${name}: got ${got}, printed ${want}`);
}

const failed = runValidations(validations, values).filter((c) => !c.pass).map((c) => c.name);
assert.deepEqual(failed, [], 'checks that fail on the sample');

// Every named sample (loaded as a worksheet template) runs without errors and passes every check.
for (const s of calcSetSamples(set)) {
  const r = computeAll(variables.map((v) => (v.name in s.values ? { ...v, value: s.values[v.name] } : v)), formulas);
  assert.deepEqual(r.trace.filter((t) => t.error).map((t) => t.formulaName), [], `${s.name}: formulas failed`);
  const bad = runValidations(validations, r.values).filter((c) => !c.pass).map((c) => c.name);
  assert.deepEqual(bad, [], `${s.name}: checks fail`);
}

console.log(`ibr calc set ok: ${formulas.length} formulas, ${variables.length - formulas.length} inputs, ${validations.length} checks, `
  + `${Object.keys(set.expected).length} results within ${(worst * 100).toFixed(2)}% of the printed calculation`);
