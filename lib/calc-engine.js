// lib/calc-engine.js — Calc module's pure computation core. No DB, no Next-server imports — this
// file is imported by both the server (snapshot save, lib/calc.js) and the 'use client' workspace
// (live recompute while editing). That's deliberate: identical code path both places is what makes
// "reproduce" trustworthy. Ported from an isolated prototype (calc-engine-prototype.jsx).
// See SYSTEM.md §5f for the module overview and what's deliberately deferred (real material data,
// project hierarchy, drawings — the next round).
import * as math from 'mathjs';

const STANDARD_SIZES = [6, 8, 10, 12, 14, 16, 20, 25];
// Accepts/returns either a plain number or a mathjs Unit (computeAll wraps physical-unit variables
// as Units before evaluation — see wrapUnit/unwrapUnit below) — a bare mm number when called
// directly (e.g. from a test), a mathjs Unit when chained after another formula in the methodology.
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

// Phase 1.1 (units) — a variable's `unit` string ('bar', 'MPa', 'mm', 'kgf/cm2', ...) is a real
// mathjs unit, wrapped into a Unit instance before formula evaluation so mixed-unit inputs convert
// automatically (mathjs handles compound units like kgf/cm2 natively, no custom registration
// needed). '-' and empty/missing units stay plain numbers — that's the dimensionless case
// (efficiencies, factors). An unrecognized unit string falls back to a plain number rather than
// crashing the run — same silent-passthrough the engine already had for every variable pre-Phase-1.
function isPhysicalUnit(unit) {
  return !!unit && unit.trim() !== '' && unit.trim() !== '-';
}

function wrapUnit(value, unit) {
  if (typeof value !== 'number' || Number.isNaN(value) || !isPhysicalUnit(unit)) return value;
  try {
    return engine.unit(value, unit);
  } catch {
    return value;
  }
}

// Converts a mathjs Unit evaluation result back to a plain number in the formula's declared output
// unit — this is where a genuine dimension mismatch (e.g. a formula that adds a Pressure to a
// Length) surfaces: Unit.toNumber() throws "Units do not match" / "Cannot convert...", which the
// caller (computeAll's visit()) catches exactly like any other formula error, so it shows up in the
// execution trace instead of silently returning a wrong number.
function unwrapUnit(result, targetUnit) {
  if (result == null || typeof result.toNumber !== 'function') return result;
  return isPhysicalUnit(targetUnit) ? result.toNumber(targetUnit) : result.toNumber();
}

export function round(n) {
  return typeof n === 'number' && !Number.isNaN(n) ? Math.round(n * 1000) / 1000 : n;
}

export function extractDeps(expr, names) {
  return names.filter((n) => new RegExp(`\\b${n}\\b`).test(expr));
}

// Phase 1.3 (lookup tables) — 1D linear interpolation between the two rows bracketing x. Outside
// the table's range, extrapolates linearly from the two nearest points rather than clamping or
// erroring (an out-of-range material property is a real engineering situation, not invalid input),
// but always reports it via `warn` so the caller can surface it instead of it passing silently.
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
  const y0 = lo.values[columnName];
  const y1 = hi.values[columnName];
  const t = hi.x === lo.x ? 0 : (x - lo.x) / (hi.x - lo.x);
  return wrapUnit(y0 + t * (y1 - y0), col.unit);
}

// Pre-loaded formulas cited to real published codes — importable into the methodology from the
// Library view. Static (not DB-backed): these are reference material, not company config.
export const LIBRARY = [
  {
    id: 'lib_asme_ug27',
    name: 'Cylindrical shell thickness',
    expr: '(Pressure * Radius) / (AllowableStress * WeldEfficiency - 0.6 * Pressure)',
    outputVar: 'RequiredThickness',
    standard: 'ASME BPVC Section VIII, Division 1',
    clause: 'UG-27(c)(1)',
    edition: '2023 Edition',
    url: 'https://www.asme.org/codes-standards/bpvc-standards',
    note: 'Thin-wall formula; valid when t ≤ R/2 or P ≤ 0.385·S·E.',
    requiredVars: [
      { name: 'Pressure', type: 'input', unit: 'MPa' },
      { name: 'Radius', type: 'input', unit: 'mm' },
      { name: 'AllowableStress', type: 'constant', unit: 'MPa' },
      { name: 'WeldEfficiency', type: 'constant', unit: '-' },
    ],
  },
  {
    id: 'lib_ibr_shell',
    name: 'Boiler shell thickness (IBR)',
    expr: '(Pressure * InsideDiameter) / (2 * AllowableStress * WeldEfficiency) + CorrosionAllowance',
    outputVar: 'RequiredThickness_IBR',
    standard: 'Indian Boiler Regulations, 1950',
    clause: 'Reg. 275',
    edition: null,
    url: 'https://mahaboiler.in/boiler/images/pdf/IBR_CERTIFICATES&FORMS.pdf',
    note: 'Minimum shell thickness per IBR must not be less than 7 mm; best double-welded butt joint typically taken at 85% efficiency.',
    requiredVars: [
      { name: 'Pressure', type: 'input', unit: 'kgf/cm2' },
      { name: 'InsideDiameter', type: 'input', unit: 'mm' },
      { name: 'AllowableStress', type: 'constant', unit: 'kgf/mm2' },
      { name: 'WeldEfficiency', type: 'constant', unit: '-' },
      { name: 'CorrosionAllowance', type: 'constant', unit: 'mm' },
    ],
  },
  {
    id: 'lib_next_standard',
    name: 'Round up to next standard plate size',
    expr: 'nextStandard(RequiredThickness)',
    outputVar: 'SelectedThickness',
    standard: 'Company component library',
    clause: 'Standard plate sizes: 6/8/10/12/14/16/20/25 mm',
    url: null,
    note: 'Selection rule, not a code formula — configure the size list per company.',
    requiredVars: [{ name: 'RequiredThickness', type: 'computed', unit: 'mm' }],
  },
];

// Tarjan's SCC algorithm over the formula dependency graph (depsOf: formula id -> ids it reads
// from). Returns groups of formula ids in dependency-first order — a group's own deps (from other
// groups) are always earlier in the returned array. A group of size 1 is only a real cycle if that
// formula depends on itself (self-loop); everything else is the normal single-pass case.
// This is Phase 1.2's cycle *detection* — real circular dependencies (heat transfer coefficient
// depending on gas velocity depending on flow area depending back on the coefficient, per Kimi's
// brief) are the reason computeAll can't just be a single topological pass.
function findCycleGroups(formulaIds, depsOf) {
  let index = 0;
  const indices = new Map();
  const lowlink = new Map();
  const onStack = new Map();
  const stack = [];
  const groups = [];

  function strongconnect(id) {
    indices.set(id, index);
    lowlink.set(id, index);
    index++;
    stack.push(id);
    onStack.set(id, true);
    (depsOf[id] || []).forEach((depId) => {
      if (!indices.has(depId)) {
        strongconnect(depId);
        lowlink.set(id, Math.min(lowlink.get(id), lowlink.get(depId)));
      } else if (onStack.get(depId)) {
        lowlink.set(id, Math.min(lowlink.get(id), indices.get(depId)));
      }
    });
    if (lowlink.get(id) === indices.get(id)) {
      const group = [];
      let w;
      do {
        w = stack.pop();
        onStack.set(w, false);
        group.push(w);
      } while (w !== id);
      groups.push(group);
    }
  }
  formulaIds.forEach((id) => { if (!indices.has(id)) strongconnect(id); });
  return groups;
}

// Runs every formula once, in dependency order (derived from variable names referenced in each
// expression — no manual graph wiring). Formulas in a circular dependency group instead run through
// an iterative convergence loop (Gauss-Seidel style — each formula's update is immediately visible
// to the next one in the same pass, converges faster than batching a whole pass before applying it)
// until every formula's relative change drops below its own iteration_tolerance, or its
// iteration_max is hit. formulaVersionOverride/inputOverride let a snapshot pin exact values
// regardless of what the live registry/methodology look like now (reproduce). `tables` (Phase 1.3)
// makes LOOKUP("name", x, "column") available inside formula expressions.
//
// LOOKUP is (re)registered on the shared `engine` fresh on every call, bound to *this* call's
// `tables` via closure — safe because computeAll is entirely synchronous (no await anywhere in it),
// so Node's single-threaded event loop can never interleave another computeAll call's evaluate()
// in between; the shared engine is never observed with the "wrong" call's LOOKUP bound to it.
export function computeAll(variables, formulas, { formulaVersionOverride = {}, inputOverride = {}, tables = [] } = {}) {
  const names = variables.map((v) => v.name);
  const values = {};
  const unitByName = {};
  variables.forEach((v) => {
    values[v.name] = inputOverride[v.name] !== undefined ? inputOverride[v.name] : v.value;
    unitByName[v.name] = v.unit;
  });
  const outputOwner = {};
  formulas.forEach((f) => (outputOwner[f.outputVar] = f.id));

  // Phase 3, item 14 (array/list variables) — SUM/COUNT read a variable's rows by name (passed as a
  // quoted string, same convention as LOOKUP's table name, so mathjs doesn't try to resolve it as a
  // scope variable). Excluded from `used`/inputsUsed below since an array has no scalar value to
  // show there — same reasoning LOOKUP's quoted table name already sidesteps.
  const arrayRowsByName = {};
  const arrayVarNames = new Set();
  variables.forEach((v) => {
    if (v.type === 'array') { arrayRowsByName[v.name] = v.arrayRows || []; arrayVarNames.add(v.name); }
  });

  const versionOf = (f) => {
    const vnum = formulaVersionOverride[f.id] ?? f.curV;
    return f.versions.find((ver) => ver.v === vnum);
  };
  const depsOf = {};
  formulas.forEach((f) => {
    const used = extractDeps(versionOf(f).expr, names);
    depsOf[f.id] = used.map((n) => outputOwner[n]).filter((id) => id && id !== f.id);
  });

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
    } catch (e) {
      return { value: NaN, error: e.message, warnings: pendingWarnings };
    }
  };

  const trace = [];
  const convergence = [];
  const groups = findCycleGroups(formulas.map((f) => f.id), depsOf);

  groups.forEach((groupIds) => {
    const group = groupIds.map((id) => formulas.find((f) => f.id === id)).filter(Boolean);
    // A single formula referencing its own output var can't reach this branch — depsOf already
    // excludes self-references (`id !== f.id` above) so a self-loop never survives into the graph.
    // Real cycles here are always multi-formula, matching Kimi's brief's own example (a heat
    // transfer coefficient depending on gas velocity depending back on the coefficient).
    const isCycle = group.length > 1;

    if (!isCycle) {
      const f = group[0];
      const ver = versionOf(f);
      const used = extractDeps(ver.expr, names);
      const inputsUsed = {};
      used.forEach((n) => { if (!arrayVarNames.has(n)) inputsUsed[n] = values[n]; });

      // Phase 2.4 (conditional formula execution) — an optional boolean guard on the formula
      // version. Guards are evaluated against plain input/constant values only (not other computed
      // formulas' outputs), same restriction the doc calls out — a guard that depended on a computed
      // value would need its own resolution order, which no seeded demo formula needs yet. A false
      // guard skips the formula entirely: the output var keeps whatever value it already had (0/null
      // if never computed) instead of being overwritten, so a downstream formula reading it sees a
      // stable "not applicable this run" value rather than a stale recompute.
      if (ver.guardExpr) {
        let guardPass;
        try {
          guardPass = !!engine.evaluate(ver.guardExpr, values);
        } catch (e) {
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

    // Seed each cyclic output at its current/stored value (0 if never computed) — an iterative
    // solve needs a starting point, same as any real Gauss-Seidel/Newton setup.
    group.forEach((f) => {
      if (typeof values[f.outputVar] !== 'number' || Number.isNaN(values[f.outputVar])) values[f.outputVar] = 0;
    });

    const maxIter = Math.max(...group.map((f) => f.iterationMax ?? 50));
    const tolerance = Math.min(...group.map((f) => f.iterationTolerance ?? 0.001));
    const history = [];
    let converged = false;
    let iterationsRun = 0;

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

// Phase 2.2 (goal-seek) — bisection, not Newton-Raphson: no derivative needed, and it's robust for
// the common case (a monotonic engineering response between the two bracket points) at half the
// code. Reuses computeAll as a black-box function — each trial just overrides one input and reads
// one output, same mechanism a snapshot's inputOverride already uses.
export function goalSeek(variables, formulas, { inputVar, outputVar, target, tables = [], lo, hi, tolerance = 0.001, maxIter = 60 } = {}) {
  const runAt = (x) => computeAll(variables, formulas, { inputOverride: { [inputVar]: x }, tables }).values[outputVar];
  let a = lo, b = hi;
  let fa = runAt(a) - target;
  let fb = runAt(b) - target;
  if (Number.isNaN(fa) || Number.isNaN(fb)) {
    return { converged: false, iterations: 0, value: null, history: [], error: `${outputVar} came back non-numeric at one of the bracket ends — check the formula chain and units.` };
  }
  if (Math.sign(fa) === Math.sign(fb) && fa !== 0 && fb !== 0) {
    return { converged: false, iterations: 0, value: null, history: [], error: `${outputVar} does not cross ${target} between ${inputVar}=${lo} and ${inputVar}=${hi} — widen the bracket.` };
  }
  const history = [];
  let mid = fa === 0 ? a : b;
  let fmid = fa === 0 ? fa : fb;
  let iter = 0;
  if (fa !== 0 && fb !== 0) {
    for (; iter < maxIter; iter++) {
      mid = (a + b) / 2;
      fmid = runAt(mid) - target;
      history.push({ iteration: iter + 1, input: mid, output: fmid + target });
      if (Math.abs(fmid) <= tolerance || (b - a) / 2 < tolerance) break;
      if (Math.sign(fmid) === Math.sign(fa)) { a = mid; fa = fmid; } else { b = mid; fb = fmid; }
    }
  }
  return { converged: Math.abs(fmid) <= tolerance, iterations: history.length, value: mid, history };
}

// Phase 2.3 (sensitivity analysis) — sweeps one input across +/-range around its current value in
// `steps` points, running computeAll fresh at each one. N plain computeAll calls, no incremental
// differencing — the problem size here (a handful of formulas, a handful of points) doesn't need it.
export function sensitivityAnalysis(variables, formulas, { inputVar, outputVar, range = 0.2, steps = 11, tables = [] } = {}) {
  const baseVar = variables.find((v) => v.name === inputVar);
  const base = baseVar?.value;
  if (typeof base !== 'number' || Number.isNaN(base)) {
    return { points: [], base: null, error: `${inputVar} has no numeric current value to sweep around.` };
  }
  const points = [];
  for (let i = 0; i < steps; i++) {
    const frac = steps === 1 ? 0 : -range + (2 * range * i) / (steps - 1);
    const x = base * (1 + frac);
    points.push({ input: x, output: computeAll(variables, formulas, { inputOverride: { [inputVar]: x }, tables }).values[outputVar] });
  }
  return { points, base };
}

// Phase 3.2 (change impact analysis) — before approving a formula version, checks which past
// snapshots pinned this formula and whether swapping in the candidate version would change their
// results or flip any validation's pass/fail. Pure: takes the already-loaded snapshots/validations
// (no DB access here — the server and the live client-side preview share this one implementation,
// same "one path, two call sites" precedent as Phase 1.4's runFormulaTests).
export function changeImpact(variables, formulas, snapshots, validations, { formulaId, newVersion, tables = [] } = {}) {
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

export function runValidations(validations, values) {
  return validations.map((rule) => {
    let ok, error = null;
    try {
      ok = !!engine.evaluate(rule.expr, values);
    } catch (e) {
      ok = false;
      error = e.message;
    }
    return { ...rule, pass: ok, error };
  });
}

// Phase 1.4 — a test case pins a set of input values (test.inputs, fed to computeAll exactly like a
// snapshot's inputOverride) and the output that formula must produce from them, within tolerance.
// Reused both for a live preview in Methodology and as the actual save-time gate (lib/calc.js) — one
// implementation, so "looks passing in the UI" and "the gate that gets enforced" can't drift apart.
export function runFormulaTests(variables, formulas, formulaId, tests, tables = []) {
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
