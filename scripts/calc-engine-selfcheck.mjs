// scripts/calc-engine-selfcheck.mjs — runnable check for the calc engine's pure core (dependency
// order, arithmetic, units, iteration/convergence, lookup tables, regression tests, validation
// pass/fail). Same precedent as inventory-reservations-selfcheck.mjs: lib/calc-engine.js uses this
// codebase's extensionless-import convention, which only Next's bundler resolves — a plain node
// script can't import it directly, so the pure functions are hand-copied here, byte-for-byte from
// lib/calc-engine.js. Keep this in sync whenever that file changes.
//   node scripts/calc-engine-selfcheck.mjs
import assert from 'node:assert';
import * as math from 'mathjs';

const STANDARD_SIZES = [6, 8, 10, 12, 14, 16, 20, 25];
function nextStandard(x) {
  const isUnit = x != null && typeof x.toNumber === 'function';
  const n = isUnit ? x.toNumber('mm') : x;
  if (typeof n !== 'number' || Number.isNaN(n)) return NaN;
  const found = STANDARD_SIZES.find((s) => s >= n);
  const result = found === undefined ? STANDARD_SIZES[STANDARD_SIZES.length - 1] : found;
  return isUnit ? engine.unit(result, 'mm') : result;
}

const engine = math.create(math.all);
engine.import({ nextStandard }, { override: true });

function isPhysicalUnit(unit) { return !!unit && unit.trim() !== '' && unit.trim() !== '-'; }
function wrapUnit(value, unit) {
  if (typeof value !== 'number' || Number.isNaN(value) || !isPhysicalUnit(unit)) return value;
  try { return engine.unit(value, unit); } catch { return value; }
}
function unwrapUnit(result, targetUnit) {
  if (result == null || typeof result.toNumber !== 'function') return result;
  return isPhysicalUnit(targetUnit) ? result.toNumber(targetUnit) : result.toNumber();
}

function round(n) { return typeof n === 'number' && !Number.isNaN(n) ? Math.round(n * 1000) / 1000 : n; }
function extractDeps(expr, names) { return names.filter((n) => new RegExp(`\\b${n}\\b`).test(expr)); }

function interpolate(table, xValue, columnName, warn) {
  const col = table.columns.find((c) => c.name === columnName);
  if (!col) throw new Error(`Table "${table.name}" has no column "${columnName}"`);
  const x = (xValue != null && typeof xValue.toNumber === 'function') ? xValue.toNumber(table.xUnit || undefined) : xValue;
  if (typeof x !== 'number' || Number.isNaN(x)) throw new Error(`LOOKUP("${table.name}") needs a numeric x value`);
  const rows = [...table.rows].sort((a, b) => a.x - b.x);
  if (rows.length === 0) throw new Error(`Table "${table.name}" has no rows`);
  if (rows.length === 1) return wrapUnit(rows[0].values[columnName], col.unit);
  let lo, hi;
  if (x <= rows[0].x) {
    [lo, hi] = [rows[0], rows[1]];
    if (x < rows[0].x) warn(`LOOKUP("${table.name}", ${x}) is below the table's range (min ${rows[0].x}) — extrapolated.`);
  } else if (x >= rows[rows.length - 1].x) {
    [lo, hi] = [rows[rows.length - 2], rows[rows.length - 1]];
    if (x > rows[rows.length - 1].x) warn(`LOOKUP("${table.name}", ${x}) is above the table's range (max ${rows[rows.length - 1].x}) — extrapolated.`);
  } else {
    const i = rows.findIndex((r, idx) => idx < rows.length - 1 && x >= r.x && x <= rows[idx + 1].x);
    [lo, hi] = [rows[i], rows[i + 1]];
  }
  const y0 = lo.values[columnName], y1 = hi.values[columnName];
  const t = hi.x === lo.x ? 0 : (x - lo.x) / (hi.x - lo.x);
  return wrapUnit(y0 + t * (y1 - y0), col.unit);
}

function findCycleGroups(formulaIds, depsOf) {
  let index = 0;
  const indices = new Map(), lowlink = new Map(), onStack = new Map(), stack = [], groups = [];
  function strongconnect(id) {
    indices.set(id, index); lowlink.set(id, index); index++;
    stack.push(id); onStack.set(id, true);
    (depsOf[id] || []).forEach((depId) => {
      if (!indices.has(depId)) {
        strongconnect(depId);
        lowlink.set(id, Math.min(lowlink.get(id), lowlink.get(depId)));
      } else if (onStack.get(depId)) {
        lowlink.set(id, Math.min(lowlink.get(id), indices.get(depId)));
      }
    });
    if (lowlink.get(id) === indices.get(id)) {
      const group = []; let w;
      do { w = stack.pop(); onStack.set(w, false); group.push(w); } while (w !== id);
      groups.push(group);
    }
  }
  formulaIds.forEach((id) => { if (!indices.has(id)) strongconnect(id); });
  return groups;
}

function computeAll(variables, formulas, { formulaVersionOverride = {}, inputOverride = {}, tables = [] } = {}) {
  const names = variables.map((v) => v.name);
  const values = {};
  const unitByName = {};
  variables.forEach((v) => {
    values[v.name] = inputOverride[v.name] !== undefined ? inputOverride[v.name] : v.value;
    unitByName[v.name] = v.unit;
  });
  const outputOwner = {};
  formulas.forEach((f) => (outputOwner[f.outputVar] = f.id));
  const versionOf = (f) => f.versions.find((ver) => ver.v === (formulaVersionOverride[f.id] ?? f.curV));
  const depsOf = {};
  formulas.forEach((f) => {
    const used = extractDeps(versionOf(f).expr, names);
    depsOf[f.id] = used.map((n) => outputOwner[n]).filter((id) => id && id !== f.id);
  });

  const arrayRowsByName = {};
  const arrayVarNames = new Set();
  variables.forEach((v) => { if (v.type === 'array') { arrayRowsByName[v.name] = v.arrayRows || []; arrayVarNames.add(v.name); } });

  let pendingWarnings = [];
  engine.import({
    LOOKUP: (tableName, x, columnName) => {
      const table = tables.find((t) => t.name === tableName);
      if (!table) throw new Error(`Unknown table "${tableName}"`);
      return interpolate(table, x, columnName, (msg) => pendingWarnings.push(msg));
    },
    SUM: (arrayVarName, columnName) => {
      if (!(arrayVarName in arrayRowsByName)) throw new Error(`Unknown array variable "${arrayVarName}"`);
      return arrayRowsByName[arrayVarName].reduce((s, row) => s + (Number(row[columnName]) || 0), 0);
    },
    COUNT: (arrayVarName) => {
      if (!(arrayVarName in arrayRowsByName)) throw new Error(`Unknown array variable "${arrayVarName}"`);
      return arrayRowsByName[arrayVarName].length;
    },
  }, { override: true });

  const evalOne = (f) => {
    const ver = versionOf(f);
    const unitScope = {};
    names.forEach((n) => { unitScope[n] = wrapUnit(values[n], unitByName[n]); });
    pendingWarnings = [];
    try {
      const value = unwrapUnit(engine.evaluate(ver.expr, unitScope), f.unit);
      return { value, error: null, warnings: pendingWarnings };
    } catch (e) { return { value: NaN, error: e.message, warnings: pendingWarnings }; }
  };

  const trace = [], convergence = [];
  const groups = findCycleGroups(formulas.map((f) => f.id), depsOf);

  groups.forEach((groupIds) => {
    const group = groupIds.map((id) => formulas.find((f) => f.id === id)).filter(Boolean);
    const isCycle = group.length > 1;

    if (!isCycle) {
      const f = group[0];
      const ver = versionOf(f);
      const used = extractDeps(ver.expr, names);
      const inputsUsed = {};
      used.forEach((n) => { if (!arrayVarNames.has(n)) inputsUsed[n] = values[n]; });

      if (ver.guardExpr) {
        let guardPass;
        try { guardPass = !!engine.evaluate(ver.guardExpr, values); }
        catch (e) {
          trace.push({ formulaId: f.id, formulaName: f.name, version: ver.v, expr: ver.expr, inputsUsed, output: values[f.outputVar], error: `Guard error: ${e.message}`, warnings: [], status: f.status, guardExpr: ver.guardExpr });
          return;
        }
        if (!guardPass) {
          trace.push({ formulaId: f.id, formulaName: f.name, version: ver.v, expr: ver.expr, inputsUsed, output: values[f.outputVar], error: null, warnings: [], status: f.status, guardExpr: ver.guardExpr, skipped: true });
          return;
        }
      }

      const { value: output, error, warnings } = evalOne(f);
      values[f.outputVar] = output;
      trace.push({ formulaId: f.id, formulaName: f.name, version: ver.v, expr: ver.expr, inputsUsed, output, error, warnings, status: f.status, ...(ver.guardExpr ? { guardExpr: ver.guardExpr } : {}) });
      return;
    }

    group.forEach((f) => {
      if (typeof values[f.outputVar] !== 'number' || Number.isNaN(values[f.outputVar])) values[f.outputVar] = 0;
    });

    const maxIter = Math.max(...group.map((f) => f.iterationMax ?? 50));
    const tolerance = Math.min(...group.map((f) => f.iterationTolerance ?? 0.001));
    const history = [];
    let converged = false, iterationsRun = 0;

    for (let iter = 1; iter <= maxIter; iter++) {
      let maxRelDelta = 0;
      group.forEach((f) => {
        const { value: raw, error, warnings } = evalOne(f);
        const damping = f.iterationDamping ?? 1;
        const prev = values[f.outputVar];
        const next = Number.isNaN(raw) ? raw : damping * raw + (1 - damping) * prev;
        const delta = prev !== 0 && !Number.isNaN(prev) ? Math.abs((next - prev) / prev) : Math.abs(next || 0);
        values[f.outputVar] = next;
        history.push({ iteration: iter, formulaId: f.id, formulaName: f.name, variable: f.outputVar, value: next, delta, error, warnings });
        if (!Number.isNaN(delta)) maxRelDelta = Math.max(maxRelDelta, delta);
      });
      iterationsRun = iter;
      if (maxRelDelta < tolerance) { converged = true; break; }
    }

    convergence.push({ outputVars: group.map((f) => f.outputVar), converged, iterations: iterationsRun, maxIterations: maxIter, tolerance, history });

    group.forEach((f) => {
      const ver = versionOf(f);
      const used = extractDeps(ver.expr, names);
      const inputsUsed = {};
      used.forEach((n) => { if (!arrayVarNames.has(n)) inputsUsed[n] = values[n]; });
      const lastEntry = [...history].reverse().find((h) => h.formulaId === f.id);
      trace.push({
        formulaId: f.id, formulaName: f.name, version: ver.v, expr: ver.expr, inputsUsed,
        output: values[f.outputVar], error: lastEntry?.error ?? null, warnings: lastEntry?.warnings ?? [], status: f.status,
        iterations: iterationsRun, converged,
      });
    });
  });

  return { values, trace, convergence };
}

function goalSeek(variables, formulas, { inputVar, outputVar, target, tables = [], lo, hi, tolerance = 0.001, maxIter = 60 } = {}) {
  const runAt = (x) => computeAll(variables, formulas, { inputOverride: { [inputVar]: x }, tables }).values[outputVar];
  let a = lo, b = hi;
  let fa = runAt(a) - target, fb = runAt(b) - target;
  if (Number.isNaN(fa) || Number.isNaN(fb)) return { converged: false, iterations: 0, value: null, history: [], error: 'non-numeric bracket end' };
  if (Math.sign(fa) === Math.sign(fb) && fa !== 0 && fb !== 0) return { converged: false, iterations: 0, value: null, history: [], error: 'no sign change in bracket' };
  const history = [];
  let mid = fa === 0 ? a : b, fmid = fa === 0 ? fa : fb;
  if (fa !== 0 && fb !== 0) {
    for (let iter = 0; iter < maxIter; iter++) {
      mid = (a + b) / 2;
      fmid = runAt(mid) - target;
      history.push({ iteration: iter + 1, input: mid, output: fmid + target });
      if (Math.abs(fmid) <= tolerance || (b - a) / 2 < tolerance) break;
      if (Math.sign(fmid) === Math.sign(fa)) { a = mid; fa = fmid; } else { b = mid; fb = fmid; }
    }
  }
  return { converged: Math.abs(fmid) <= tolerance, iterations: history.length, value: mid, history };
}

function sensitivityAnalysis(variables, formulas, { inputVar, outputVar, range = 0.2, steps = 11, tables = [] } = {}) {
  const base = variables.find((v) => v.name === inputVar)?.value;
  if (typeof base !== 'number' || Number.isNaN(base)) return { points: [], base: null, error: 'no numeric base value' };
  const points = [];
  for (let i = 0; i < steps; i++) {
    const frac = steps === 1 ? 0 : -range + (2 * range * i) / (steps - 1);
    const x = base * (1 + frac);
    points.push({ input: x, output: computeAll(variables, formulas, { inputOverride: { [inputVar]: x }, tables }).values[outputVar] });
  }
  return { points, base };
}

function changeImpact(variables, formulas, snapshots, validations, { formulaId, newVersion, tables = [] } = {}) {
  return snapshots
    .filter((snap) => snap.formulaVersionOverride[formulaId] !== undefined)
    .map((snap) => {
      const before = snap.results;
      const beforeChecks = runValidations(validations, before);
      const overrideAfter = { ...snap.formulaVersionOverride, [formulaId]: newVersion };
      const { values: after } = computeAll(variables, formulas, { formulaVersionOverride: overrideAfter, inputOverride: snap.inputOverride, tables });
      const afterChecks = runValidations(validations, after);
      const changedOutputs = Object.keys(before).filter((k) => round(before[k]) !== round(after[k]));
      const flippedChecks = beforeChecks
        .map((c, i) => ({ name: c.name, before: c.pass, after: afterChecks[i]?.pass }))
        .filter((c) => c.before !== c.after);
      return {
        snapshotId: snap.id, label: snap.label,
        changedOutputs: changedOutputs.map((k) => ({ variable: k, before: before[k], after: after[k] })),
        flippedChecks,
        unchanged: changedOutputs.length === 0 && flippedChecks.length === 0,
      };
    });
}

function runValidations(validations, values) {
  return validations.map((rule) => {
    let ok, error = null;
    try { ok = !!engine.evaluate(rule.expr, values); } catch (e) { ok = false; error = e.message; }
    return { ...rule, pass: ok, error };
  });
}

function runFormulaTests(variables, formulas, formulaId, tests, tables = []) {
  const formula = formulas.find((f) => f.id === formulaId);
  if (!formula) return [];
  return tests.map((test) => {
    const { values } = computeAll(variables, formulas, { inputOverride: test.inputs, tables });
    const actual = values[formula.outputVar];
    const diff = typeof actual === 'number' ? Math.abs(actual - test.expectedOutput) : NaN;
    const pass = !Number.isNaN(diff) && diff <= (test.tolerance ?? 0.01);
    return { ...test, actual, diff, pass };
  });
}

// --- assertions: Phase 1.1 (units) + core dependency/arithmetic behavior ------------------------

const variables = [
  { id: 1, name: 'Pressure', type: 'input', unit: 'bar', value: 42 },
  { id: 2, name: 'Radius', type: 'input', unit: 'mm', value: 650 },
  { id: 3, name: 'AllowableStress', type: 'constant', unit: 'MPa', value: 118 },
  { id: 4, name: 'WeldEfficiency', type: 'constant', unit: '-', value: 0.85 },
  { id: 5, name: 'RequiredThickness', type: 'computed', unit: 'mm', value: null },
  { id: 6, name: 'SelectedThickness', type: 'computed', unit: 'mm', value: null },
];
const formulas = [
  {
    id: 'f1', name: 'Required thickness', outputVar: 'RequiredThickness', unit: 'mm', curV: 1, status: 'approved',
    versions: [{ v: 1, expr: '(Pressure * Radius) / (AllowableStress * WeldEfficiency - 0.6 * Pressure)' }],
  },
  {
    id: 'f2', name: 'Selected thickness', outputVar: 'SelectedThickness', unit: 'mm', curV: 1, status: 'approved',
    versions: [{ v: 1, expr: 'nextStandard(RequiredThickness)' }],
  },
];

const { values, trace } = computeAll(variables, formulas);

const expectedMPa = math.unit(42, 'bar').toNumber('MPa');
const expected = (expectedMPa * 650) / (118 * 0.85 - 0.6 * expectedMPa);
assert.strictEqual(round(values.RequiredThickness), round(expected), 'RequiredThickness arithmetic mismatch');
assert.ok(values.RequiredThickness < 30, `unit conversion should land ~28mm, got ${values.RequiredThickness}`);
const foundSize = STANDARD_SIZES.find((s) => s >= values.RequiredThickness);
assert.strictEqual(values.SelectedThickness, foundSize ?? STANDARD_SIZES[STANDARD_SIZES.length - 1], 'nextStandard should pick the next standard size up (or clamp to the largest)');

const { trace: mismatchTrace } = computeAll(variables, [
  { id: 'fmismatch', name: 'bad dims', outputVar: 'BadDims', unit: 'mm', curV: 1, status: 'draft', versions: [{ v: 1, expr: 'Pressure + Radius' }] },
]);
assert.ok(mismatchTrace[0].error, 'adding incompatible units (Pressure + Radius) should error, not silently compute');
assert.match(mismatchTrace[0].error, /unit/i, 'dimension-mismatch error should mention units');

assert.strictEqual(trace[0].formulaName, 'Required thickness');
assert.strictEqual(trace[1].formulaName, 'Selected thickness');
assert.strictEqual(trace[1].inputsUsed.RequiredThickness, values.RequiredThickness);
assert.ok(trace[0].iterations === undefined, 'acyclic formulas should not carry iteration fields');

assert.deepStrictEqual(
  extractDeps('(Pressure * Radius) / AllowableStress', ['Pressure', 'Radius', 'AllowableStress', 'RadiusExtra']),
  ['Pressure', 'Radius', 'AllowableStress']
);

const validations = [{ id: 'v1', name: 'covers requirement', expr: 'SelectedThickness >= RequiredThickness', severity: 'fail', message: 'too thin' }];
assert.strictEqual(runValidations(validations, { SelectedThickness: 1, RequiredThickness: 10 })[0].pass, false);
assert.strictEqual(runValidations(validations, values)[0].pass, false);
assert.strictEqual(runValidations(validations, { SelectedThickness: 20, RequiredThickness: 10 })[0].pass, true);

const { values: badValues, trace: badTrace } = computeAll(variables, [
  { id: 'fbad', name: 'broken', outputVar: 'Broken', curV: 1, status: 'draft', versions: [{ v: 1, expr: 'Pressure +++ ' }] },
]);
assert.ok(Number.isNaN(badValues.Broken));
assert.ok(badTrace[0].error);

// --- assertions: Phase 1.2 (iteration/convergence) -----------------------------------------------

const cycleVars = [
  { id: 10, name: 'IterX', type: 'computed', unit: '-', value: 1 },
  { id: 11, name: 'IterY', type: 'computed', unit: '-', value: 1 },
];
const cycleFormulas = [
  { id: 'fx', name: 'X step', outputVar: 'IterX', unit: '-', curV: 1, status: 'approved', iterationTolerance: 0.0001, iterationMax: 50, iterationDamping: 1, versions: [{ v: 1, expr: 'sqrt(IterY + 10)' }] },
  { id: 'fy', name: 'Y step', outputVar: 'IterY', unit: '-', curV: 1, status: 'approved', iterationTolerance: 0.0001, iterationMax: 50, iterationDamping: 1, versions: [{ v: 1, expr: 'IterX * 2 - 3' }] },
];
const { values: cycleValues, trace: cycleTrace, convergence: cycleConvergence } = computeAll(cycleVars, cycleFormulas);
assert.strictEqual(cycleConvergence.length, 1, 'a genuine 2-formula cycle should produce exactly one convergence group');
assert.ok(cycleConvergence[0].converged, `cycle should converge within ${cycleConvergence[0].maxIterations} iterations`);
assert.ok(cycleConvergence[0].iterations > 1, 'a real iteration should take more than one pass');
assert.ok(Math.abs(cycleValues.IterX - (1 + Math.sqrt(8))) < 0.01, `IterX should converge near 3.828, got ${cycleValues.IterX}`);
assert.ok(Math.abs(cycleValues.IterY - (2 * (1 + Math.sqrt(8)) - 3)) < 0.01, `IterY should converge near 4.657, got ${cycleValues.IterY}`);
assert.ok(cycleTrace.every((t) => t.iterations === cycleConvergence[0].iterations && t.converged === true), 'every formula in the cycle should report the same iteration count/converged flag');

const { convergence: failConvergence } = computeAll(cycleVars, cycleFormulas.map((f) => ({ ...f, iterationMax: 1 })));
assert.strictEqual(failConvergence[0].converged, false, 'a cycle capped at 1 iteration should not claim convergence');
assert.strictEqual(failConvergence[0].iterations, 1);

// --- assertions: Phase 1.3 (lookup tables + interpolation) ----------------------------------------

const sa516 = {
  name: 'SA516_70', xColumn: 'Temperature', xUnit: 'degC',
  columns: [{ name: 'AllowableStress', unit: 'MPa' }],
  rows: [
    { x: 20, values: { AllowableStress: 138 } },
    { x: 100, values: { AllowableStress: 138 } },
    { x: 200, values: { AllowableStress: 130 } },
    { x: 300, values: { AllowableStress: 120 } },
    { x: 400, values: { AllowableStress: 106 } },
  ],
};
const lookupVars = [
  { id: 20, name: 'Temperature', type: 'input', unit: 'degC', value: 250 },
  { id: 21, name: 'AllowableStress', type: 'computed', unit: 'MPa', value: null },
];
const lookupFormulas = [
  { id: 'flookup', name: 'Allowable stress', outputVar: 'AllowableStress', unit: 'MPa', curV: 1, status: 'approved', versions: [{ v: 1, expr: 'LOOKUP("SA516_70", Temperature, "AllowableStress")' }] },
];
const { values: lookupValues, trace: lookupTrace } = computeAll(lookupVars, lookupFormulas, { tables: [sa516] });
// Halfway between the 200C/130MPa and 300C/120MPa rows -> exactly 125MPa, no extrapolation warning.
assert.strictEqual(lookupValues.AllowableStress, 125, `interpolation at 250C should give 125MPa, got ${lookupValues.AllowableStress}`);
assert.strictEqual(lookupTrace[0].warnings.length, 0, 'interpolation inside the table range should not warn');

const { values: extrapValues, trace: extrapTrace } = computeAll(
  lookupVars.map((v) => (v.name === 'Temperature' ? { ...v, value: 500 } : v)), lookupFormulas, { tables: [sa516] }
);
// Beyond the table's max (400C/106MPa), extrapolated linearly from the last two points (300->400).
const extrapExpected = 120 + (106 - 120) * ((500 - 300) / (400 - 300));
assert.ok(Math.abs(extrapValues.AllowableStress - extrapExpected) < 0.001, `extrapolation at 500C should give ${extrapExpected}, got ${extrapValues.AllowableStress}`);
assert.strictEqual(extrapTrace[0].warnings.length, 1, 'a value outside the table range should carry exactly one extrapolation warning');
assert.match(extrapTrace[0].warnings[0], /extrapolated/i);

const { trace: unknownTableTrace } = computeAll(lookupVars, [
  { id: 'fbadtable', name: 'bad table', outputVar: 'AllowableStress', unit: 'MPa', curV: 1, status: 'draft', versions: [{ v: 1, expr: 'LOOKUP("NOT_A_TABLE", Temperature, "AllowableStress")' }] },
], { tables: [sa516] });
assert.ok(unknownTableTrace[0].error, 'LOOKUP against an unknown table name should error, not silently return undefined');

// --- assertions: Phase 1.4 (regression test harness) ----------------------------------------------

const testVars = [
  { id: 30, name: 'Pressure', type: 'input', unit: 'bar', value: 42 },
  { id: 31, name: 'Radius', type: 'input', unit: 'mm', value: 650 },
  { id: 32, name: 'Temperature', type: 'input', unit: 'degC', value: 250 },
  { id: 33, name: 'WeldEfficiency', type: 'constant', unit: '-', value: 0.85 },
  { id: 34, name: 'AllowableStress', type: 'computed', unit: 'MPa', value: null },
  { id: 35, name: 'RequiredThickness', type: 'computed', unit: 'mm', value: null },
];
const testFormulas = [
  { id: 'ftAS', name: 'Allowable stress', outputVar: 'AllowableStress', unit: 'MPa', curV: 1, status: 'approved', versions: [{ v: 1, expr: 'LOOKUP("SA516_70", Temperature, "AllowableStress")' }] },
  { id: 'ftRT', name: 'Required thickness', outputVar: 'RequiredThickness', unit: 'mm', curV: 1, status: 'approved', versions: [{ v: 1, expr: '(Pressure * Radius) / (AllowableStress * WeldEfficiency - 0.6 * Pressure)' }] },
];
const passingTest = { id: 1, formulaId: 'ftRT', name: 'design case', inputs: { Pressure: 42, Radius: 650, Temperature: 250, WeldEfficiency: 0.85 }, expectedOutput: 26.318, tolerance: 0.01 };
const failingTest = { id: 2, formulaId: 'ftRT', name: 'wrong expectation', inputs: { Pressure: 42, Radius: 650, Temperature: 250, WeldEfficiency: 0.85 }, expectedOutput: 999, tolerance: 0.01 };
const testResults = runFormulaTests(testVars, testFormulas, 'ftRT', [passingTest, failingTest], [sa516]);
assert.strictEqual(testResults[0].pass, true, `expected passing test to pass, actual=${testResults[0].actual}`);
assert.strictEqual(testResults[1].pass, false, 'a test with a deliberately wrong expected value should fail');
assert.ok(Math.abs(testResults[0].actual - 26.318) < 0.01);

// The save-time gate (lib/calc.js's setFormulaStatus) is a thin wrapper around exactly this check —
// simulate it here since that half lives behind a DB connection this script can't make.
function simulateGate(results) {
  const failing = results.filter((r) => !r.pass);
  if (failing.length > 0) throw new Error(`${failing.length} test(s) failing`);
}
assert.doesNotThrow(() => simulateGate([testResults[0]]), 'a formula with only passing tests should not be blocked');
assert.throws(() => simulateGate(testResults), /1 test\(s\) failing/, 'a formula with a failing test should be blocked from Draft -> Pending');

// --- assertions: Phase 2.1 (multi-domain chain: thermal feeding mechanical) -----------------------

const domainVars = [
  { id: 40, name: 'Pressure', type: 'input', unit: 'bar', value: 42 },
  { id: 41, name: 'Radius', type: 'input', unit: 'mm', value: 650 },
  { id: 42, name: 'Temperature', type: 'input', unit: 'degC', value: 250 },
  { id: 43, name: 'WeldEfficiency', type: 'constant', unit: '-', value: 0.85 },
  { id: 44, name: 'AllowableStress', type: 'computed', unit: 'MPa', value: null },
  { id: 45, name: 'RequiredThickness', type: 'computed', unit: 'mm', value: null },
  { id: 46, name: 'SelectedThickness', type: 'computed', unit: 'mm', value: null },
  { id: 47, name: 'ReferenceVelocity', type: 'constant', unit: 'm/s', value: 20 },
  { id: 48, name: 'FilmCoeffConstant', type: 'constant', unit: '-', value: 45 },
  { id: 49, name: 'CoolingFactor', type: 'constant', unit: '-', value: 0.04 },
  { id: 50, name: 'ErosionConstant', type: 'constant', unit: 'mm', value: 0.05 },
  { id: 51, name: 'HeatTransferCoefficient', type: 'computed', unit: '-', value: null },
  { id: 52, name: 'GasVelocity', type: 'computed', unit: 'm/s', value: null },
  { id: 53, name: 'ThermalCorrosionAllowance', type: 'computed', unit: 'mm', value: null },
];
const domainFormulas = [
  { id: 'dAS', name: 'Allowable stress', outputVar: 'AllowableStress', unit: 'MPa', curV: 1, status: 'approved', versions: [{ v: 1, expr: 'LOOKUP("SA516_70", Temperature, "AllowableStress")' }] },
  { id: 'dRT', name: 'Required thickness', outputVar: 'RequiredThickness', unit: 'mm', curV: 1, status: 'approved', versions: [{ v: 1, expr: '(Pressure * Radius) / (AllowableStress * WeldEfficiency - 0.6 * Pressure)' }] },
  { id: 'dST', name: 'Selected thickness', outputVar: 'SelectedThickness', unit: 'mm', curV: 1, status: 'approved', versions: [{ v: 1, expr: 'nextStandard(RequiredThickness)' }] },
  { id: 'dHTC', name: 'Gas-side film coefficient', outputVar: 'HeatTransferCoefficient', unit: '-', curV: 1, status: 'approved', versions: [{ v: 1, expr: 'FilmCoeffConstant * (GasVelocity / ReferenceVelocity) ^ 0.8' }] },
  { id: 'dGV', name: 'Flue gas velocity (cooling-corrected)', outputVar: 'GasVelocity', unit: 'm/s', curV: 1, status: 'approved', versions: [{ v: 1, expr: 'ReferenceVelocity * (1 - CoolingFactor * HeatTransferCoefficient / 100)' }] },
  { id: 'dTCA', name: 'Thermal corrosion allowance', outputVar: 'ThermalCorrosionAllowance', unit: 'mm', curV: 1, status: 'approved', versions: [{ v: 1, expr: 'ErosionConstant * HeatTransferCoefficient' }] },
];
const { values: domainValues, convergence: domainConvergence } = computeAll(domainVars, domainFormulas, { tables: [sa516] });

assert.strictEqual(domainConvergence.length, 1, 'the thermal domain (HeatTransferCoefficient <-> GasVelocity) should be detected as exactly one cycle');
assert.deepStrictEqual(new Set(domainConvergence[0].outputVars), new Set(['HeatTransferCoefficient', 'GasVelocity']), 'the mechanical-domain formulas (acyclic) should not be swept into the thermal cycle');
assert.ok(domainConvergence[0].converged, `thermal cycle should converge within ${domainConvergence[0].maxIterations} iterations`);
assert.ok(Math.abs(domainValues.HeatTransferCoefficient - 44.36) < 0.01, `HeatTransferCoefficient should converge near 44.36, got ${domainValues.HeatTransferCoefficient}`);
assert.ok(Math.abs(domainValues.GasVelocity - 19.645) < 0.01, `GasVelocity should converge near 19.645 m/s, got ${domainValues.GasVelocity}`);
assert.ok(Math.abs(domainValues.ThermalCorrosionAllowance - 2.218) < 0.01, `ThermalCorrosionAllowance should land near 2.218mm (downstream of the converged coefficient), got ${domainValues.ThermalCorrosionAllowance}`);
// RequiredThickness/SelectedThickness (mechanical domain) must be untouched by the thermal domain's
// existence — it only feeds the *validation* layer, not the formula body — same numbers as the
// existing Phase 1.4 regression test's design case.
assert.ok(Math.abs(domainValues.RequiredThickness - 26.318) < 0.01, `RequiredThickness should be unaffected by the thermal domain, got ${domainValues.RequiredThickness}`);

const thermalMarginValidation = [{ id: 'v2', name: 'thermal corrosion margin', expr: '(SelectedThickness - RequiredThickness) >= ThermalCorrosionAllowance', severity: 'warning', message: 'insufficient margin' }];
assert.strictEqual(runValidations(thermalMarginValidation, domainValues)[0].pass, false, 'SelectedThickness (25mm) already falls short of RequiredThickness here, so it cannot also cover the thermal corrosion allowance');
assert.strictEqual(runValidations(thermalMarginValidation, { SelectedThickness: 30, RequiredThickness: 26.318, ThermalCorrosionAllowance: 2.218 })[0].pass, true, 'a selection with enough margin to cover the thermal allowance should pass');

// --- assertions: Phase 2.2 (goal-seek / bisection) -------------------------------------------------

const gsResult = goalSeek(variables, formulas, { inputVar: 'Pressure', outputVar: 'RequiredThickness', target: 20, lo: 10, hi: 80, tolerance: 0.001 });
assert.ok(gsResult.converged, `goal-seek should converge, got ${JSON.stringify(gsResult)}`);
assert.ok(gsResult.iterations > 1, 'bisection on a real bracket should take more than one step');
const gsCheck = computeAll(variables, formulas, { inputOverride: { Pressure: gsResult.value } }).values.RequiredThickness;
assert.ok(Math.abs(gsCheck - 20) < 0.01, `the found Pressure should actually drive RequiredThickness to ~20, got ${gsCheck}`);

const gsNoSolution = goalSeek(variables, formulas, { inputVar: 'Pressure', outputVar: 'RequiredThickness', target: 1000, lo: 10, hi: 80, tolerance: 0.001 });
assert.strictEqual(gsNoSolution.converged, false, 'a target outside the bracket should honestly report no convergence, not a wrong answer');
assert.ok(gsNoSolution.error, 'an unreachable target should carry an explanatory error');

// --- assertions: Phase 2.3 (sensitivity analysis) ---------------------------------------------------

const sens = sensitivityAnalysis(variables, formulas, { inputVar: 'Pressure', outputVar: 'RequiredThickness', range: 0.2, steps: 5 });
assert.strictEqual(sens.points.length, 5, 'should produce exactly `steps` points');
assert.strictEqual(sens.points[2].input, 42, 'the midpoint of a symmetric sweep should be the base value unchanged');
assert.ok(sens.points[0].output < sens.points[4].output, 'RequiredThickness should increase monotonically with Pressure over this range, first point should be lowest');
for (let i = 1; i < sens.points.length; i++) {
  assert.ok(sens.points[i].output > sens.points[i - 1].output, 'sweep output should be monotonically increasing across all points for this formula');
}

// --- assertions: Phase 2.4 (conditional formula execution / guards) --------------------------------

const guardVars = [
  { id: 60, name: 'Temperature', type: 'input', unit: 'degC', value: 250 },
  { id: 61, name: 'CondensateDrainAllowance', type: 'computed', unit: 'mm', value: null },
];
const guardFormulas = [
  { id: 'gCDA', name: 'Condensate drain allowance', outputVar: 'CondensateDrainAllowance', unit: 'mm', curV: 1, status: 'approved', versions: [{ v: 1, expr: '2', guardExpr: 'Temperature < 100' }] },
];
const { trace: guardOffTrace, values: guardOffValues } = computeAll(guardVars, guardFormulas);
assert.strictEqual(guardOffTrace[0].skipped, true, 'guard false (Temperature=250, not < 100) should skip the formula');
assert.ok(!guardOffValues.CondensateDrainAllowance, 'a skipped formula should not produce/overwrite an output value');

const { trace: guardOnTrace, values: guardOnValues } = computeAll(
  guardVars.map((v) => (v.name === 'Temperature' ? { ...v, value: 60 } : v)), guardFormulas
);
assert.ok(!guardOnTrace[0].skipped, 'guard true (Temperature=60 < 100) should run the formula normally');
assert.strictEqual(guardOnValues.CondensateDrainAllowance, 2, 'the guarded formula should compute normally once its guard passes');

const { trace: guardErrTrace } = computeAll(guardVars, [
  { id: 'gBad', name: 'bad guard', outputVar: 'CondensateDrainAllowance', unit: 'mm', curV: 1, status: 'draft', versions: [{ v: 1, expr: '2', guardExpr: 'NotAVariable +++ ' }] },
]);
assert.ok(guardErrTrace[0].error, 'a broken guard expression should surface as a trace error, not silently pass/skip');

// --- assertions: Phase 3.2 (change impact analysis) -------------------------------------------------

const impactSnapshot = {
  id: 901, label: 'Impact test snapshot',
  inputOverride: { Pressure: 42, Radius: 650, WeldEfficiency: 0.85 },
  formulaVersionOverride: { f1: 1, f2: 1 },
  results: values, // reuses the top-of-file computeAll() result (v1 of both formulas)
};
// A *1.2 margin bump, not +5mm — mathjs unit arithmetic allows scalar*Unit unconditionally, but a
// bare unitless "+5" against a Unit(mm) result throws ("addScalar expected Unit, got number"), which
// would just be testing the unit system's own guard rail again rather than change-impact itself.
const formulasWithV2 = formulas.map((f) => f.id === 'f1'
  ? { ...f, versions: [...f.versions, { v: 2, expr: '(Pressure * Radius) / (AllowableStress * WeldEfficiency - 0.6 * Pressure) * 1.2' }] }
  : f);

const impactChanged = changeImpact(variables, formulasWithV2, [impactSnapshot], validations, { formulaId: 'f1', newVersion: 2 });
assert.strictEqual(impactChanged.length, 1, 'exactly one snapshot pinned f1 and should be flagged');
assert.strictEqual(impactChanged[0].unchanged, false, 'a formula change that shifts the output by 20% should be flagged as changed');
assert.ok(impactChanged[0].changedOutputs.some((c) => c.variable === 'RequiredThickness'), 'RequiredThickness should be in the changed-outputs list');
const rtChange = impactChanged[0].changedOutputs.find((c) => c.variable === 'RequiredThickness');
assert.ok(Math.abs(rtChange.after - rtChange.before * 1.2) < 0.001, `the *1.2 margin change should show up as a 20% increase, got before=${rtChange.before} after=${rtChange.after}`);

const impactUnchanged = changeImpact(variables, formulasWithV2, [impactSnapshot], validations, { formulaId: 'f1', newVersion: 1 });
assert.strictEqual(impactUnchanged[0].unchanged, true, 're-checking against the same version that was actually pinned should report no change');

const impactNoSnapshots = changeImpact(variables, formulasWithV2, [{ ...impactSnapshot, formulaVersionOverride: { f2: 1 } }], validations, { formulaId: 'f1', newVersion: 2 });
assert.strictEqual(impactNoSnapshots.length, 0, 'a snapshot that never pinned this formula should be excluded, not flagged');

// --- assertions: Phase 3, item 14 (array/list variables) --------------------------------------------

const arrayVars = [
  { id: 70, name: 'NozzleSchedule', type: 'array', unit: '-', value: null, arrayRows: [
    { Label: 'N1', Diameter: 450, Area: 1590.4 },
    { Label: 'N2', Diameter: 80, Area: 50.3 },
    { Label: 'N3', Diameter: 150, Area: 176.7 },
  ] },
  { id: 71, name: 'TotalNozzleArea', type: 'computed', unit: 'mm2', value: null },
  { id: 72, name: 'NozzleCount', type: 'computed', unit: '-', value: null },
];
const arrayFormulas = [
  { id: 'aSum', name: 'Total nozzle area', outputVar: 'TotalNozzleArea', unit: 'mm2', curV: 1, status: 'approved', versions: [{ v: 1, expr: 'SUM("NozzleSchedule", "Area")' }] },
  { id: 'aCount', name: 'Nozzle count', outputVar: 'NozzleCount', unit: '-', curV: 1, status: 'approved', versions: [{ v: 1, expr: 'COUNT("NozzleSchedule")' }] },
];
const { values: arrayValues, trace: arrayTrace } = computeAll(arrayVars, arrayFormulas);
assert.ok(Math.abs(arrayValues.TotalNozzleArea - (1590.4 + 50.3 + 176.7)) < 0.001, `SUM should total the Area column, got ${arrayValues.TotalNozzleArea}`);
assert.strictEqual(arrayValues.NozzleCount, 3, `COUNT should return the row count, got ${arrayValues.NozzleCount}`);
assert.deepStrictEqual(Object.keys(arrayTrace[0].inputsUsed), [], 'the array variable itself should not appear in inputsUsed (it has no scalar value to show)');

const { trace: unknownArrayTrace } = computeAll(arrayVars, [
  { id: 'aBad', name: 'bad array ref', outputVar: 'TotalNozzleArea', unit: 'mm2', curV: 1, status: 'draft', versions: [{ v: 1, expr: 'SUM("NotAnArray", "Area")' }] },
]);
assert.ok(unknownArrayTrace[0].error, 'SUM against an unknown array variable should error, not silently return 0');

console.log(
  'calc-engine-selfcheck: all assertions passed.',
  'RequiredThickness =', round(values.RequiredThickness), 'SelectedThickness =', values.SelectedThickness,
  '| cycle converged in', cycleConvergence[0].iterations, 'iterations: IterX =', round(cycleValues.IterX), 'IterY =', round(cycleValues.IterY),
  '| LOOKUP@250C =', lookupValues.AllowableStress, 'MPa, extrapolated@500C =', round(extrapValues.AllowableStress), 'MPa',
  '| regression tests: pass =', testResults[0].pass, 'fail =', testResults[1].pass,
  '| thermal domain converged in', domainConvergence[0].iterations, 'iterations: HTC =', round(domainValues.HeatTransferCoefficient),
  'GasVelocity =', round(domainValues.GasVelocity), 'm/s, ThermalCorrosionAllowance =', round(domainValues.ThermalCorrosionAllowance), 'mm',
  '| goal-seek: Pressure =', round(gsResult.value), 'bar ->', round(gsCheck), 'mm in', gsResult.iterations, 'iterations',
  '| sensitivity: RequiredThickness ranges', round(sens.points[0].output), '-', round(sens.points[4].output), 'mm over +/-20% Pressure',
  '| guard: skipped @250C =', guardOffTrace[0].skipped === true, ', active @60C =', guardOnValues.CondensateDrainAllowance,
  '| change impact: *1.2 margin ->', round(rtChange.before), '->', round(rtChange.after), 'mm on', impactChanged.length, 'snapshot(s)',
  '| array vars: TotalNozzleArea =', round(arrayValues.TotalNozzleArea), 'mm2, NozzleCount =', arrayValues.NozzleCount,
);
