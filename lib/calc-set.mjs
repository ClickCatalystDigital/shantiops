// A calc set (lib/calc-sets/*.json) is a complete, version-controlled calculation: formulas (with code clause),
// every input with a plain label, unit, group and sample value, and pass/fail checks. Pure helpers here (no DB
// import): the self-check and the client shape it with calcSetRows; scripts/load-calc-set.mjs and the demo seed load
// it into a database with loadCalcSet. Inputs land in calc_input_defs, and lib/calc.js adds any missing input to a
// sheet when it opens, so a sheet is never left without the boxes its formulas need.

// Rows in the shape lib/calc-engine.js computeAll expects (ids are positions; the self-check needs no database).
export function calcSetRows(set) {
  const variables = set.inputs.map(([name, , unit, value]) => ({ name, type: 'input', unit, value }));
  const formulas = set.formulas.map(([outputVar, name, unit, , , expr], i) => {
    variables.push({ name: outputVar, type: 'computed', unit, value: null });
    return { id: i + 1, name, outputVar, unit, curV: 1, status: 'approved', versions: [{ v: 1, expr }] };
  });
  const validations = set.checks.map(([name, expr, message], i) => ({ id: i + 1, name, expr, severity: 'fail', message }));
  return { variables, formulas, validations };
}

// One calc_input_defs row per input and per formula output (outputs only for their label and group in Results).
export function calcSetDefs(set) {
  const order = new Map(set.groups.map((g, i) => [g, i]));
  const rows = set.inputs.map(([name, label, unit, value, grp], i) => ({ name, label, unit, grp, type: 'input', default_value: value, sort_order: i }));
  set.formulas.forEach(([outputVar, label, unit, , grp], i) => rows.push({ name: outputVar, label, unit, grp, type: 'computed', default_value: null, sort_order: 1000 + i }));
  for (const r of rows) {
    if (!order.has(r.grp)) throw new Error(`${r.name}: unknown group "${r.grp}"`);
    r.grp_order = order.get(r.grp);
  }
  return rows;
}

// Each named sample as a complete { inputName: value } map (the set's defaults with the sample's overrides), so
// applying one on a sheet always gives the same result, whatever was typed there before.
export function calcSetSamples(set) {
  const defaults = Object.fromEntries(set.inputs.map(([name, , , value]) => [name, value]));
  return (set.samples || []).map((s) => {
    for (const k of Object.keys(s.values)) if (!(k in defaults)) throw new Error(`sample "${s.name}": unknown input ${k}`);
    return { name: s.name, description: s.description || null, values: { ...defaults, ...s.values } };
  });
}

// Load a set into a database. db = { run(sql, args), get(sql, args) }. Idempotent: formulas are matched by output
// name (a changed expression becomes a new approved version), inputs and checks by name. Existing sheets pick up
// new inputs the next time they open.
export async function loadCalcSet(db, set, { by = 'calc-set' } = {}) {
  const summary = { formulasAdded: 0, formulasUpdated: 0, defs: 0, checks: 0 };
  for (const [outputVar, name, unit, clause, , expr] of set.formulas) {
    const f = await db.get('SELECT id, cur_v FROM calc_formulas WHERE output_var = ?', [outputVar]);
    if (!f) {
      await db.run(`INSERT INTO calc_formulas (name, output_var, unit, cur_v, status, source_standard, source_clause, source_edition)
                    VALUES (?, ?, ?, 1, 'approved', ?, ?, NULL)`, [name, outputVar, unit, clause ? set.standard : null, clause || null]);
      const nf = await db.get('SELECT id FROM calc_formulas WHERE output_var = ?', [outputVar]);
      await db.run('INSERT INTO calc_formula_versions (formula_id, v, expr, note) VALUES (?, 1, ?, ?)', [nf.id, expr, `Loaded from calc set ${set.key}`]);
      summary.formulasAdded++;
      continue;
    }
    await db.run('UPDATE calc_formulas SET name = ?, unit = ?, source_standard = ?, source_clause = ? WHERE id = ?',
      [name, unit, clause ? set.standard : null, clause || null, f.id]);
    const cur = await db.get('SELECT expr FROM calc_formula_versions WHERE formula_id = ? AND v = ?', [f.id, f.cur_v]);
    if (cur?.expr !== expr) {
      const v = Number(f.cur_v) + 1;
      await db.run('INSERT INTO calc_formula_versions (formula_id, v, expr, note) VALUES (?, ?, ?, ?)', [f.id, v, expr, `Updated from calc set ${set.key} by ${by}`]);
      await db.run("UPDATE calc_formulas SET cur_v = ?, status = 'approved' WHERE id = ?", [v, f.id]);
      summary.formulasUpdated++;
    }
  }
  for (const d of calcSetDefs(set)) {
    await db.run(`INSERT INTO calc_input_defs (name, label, unit, grp, grp_order, sort_order, type, default_value, calc_set)
                  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                  ON CONFLICT(name) DO UPDATE SET label = excluded.label, unit = excluded.unit, grp = excluded.grp, grp_order = excluded.grp_order,
                    sort_order = excluded.sort_order, type = excluded.type, default_value = excluded.default_value, calc_set = excluded.calc_set`,
      [d.name, d.label, d.unit, d.grp, d.grp_order, d.sort_order, d.type, d.default_value, set.key]);
    summary.defs++;
  }
  for (const [name, expr, message] of set.checks) {
    const c = await db.get('SELECT id FROM calc_validations WHERE name = ?', [name]);
    if (c) await db.run("UPDATE calc_validations SET expr = ?, severity = 'fail', message = ? WHERE id = ?", [expr, message, c.id]);
    else await db.run("INSERT INTO calc_validations (name, expr, severity, message) VALUES (?, ?, 'fail', ?)", [name, expr, message]);
    summary.checks++;
  }
  summary.samples = 0;
  for (const s of calcSetSamples(set)) {
    await db.run(`INSERT INTO calc_templates (name, description, values_json) VALUES (?, ?, ?)
                  ON CONFLICT(name) DO UPDATE SET description = excluded.description, values_json = excluded.values_json`,
      [s.name, s.description, JSON.stringify(s.values)]);
    summary.samples++;
  }
  return summary;
}
