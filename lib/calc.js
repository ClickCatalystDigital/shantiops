// lib/calc.js — Calc module's server-only data layer (Turso reads/writes + the department gate).
// The pure computation core (computeAll/runValidations/LIBRARY) lives in lib/calc-engine.js
// instead, since that file also needs to be importable from the 'use client' workspace for live
// recompute — this file pulls in @libsql/client via lib/db, which can't ship to the browser.
import { NextResponse } from 'next/server';
import { queryAll, queryOne, execute } from './db';
import { canAccessDepartment, parseProjectIds } from './auth';
import { computeAll, runFormulaTests } from './calc-engine';
import { notifyUser } from './notify';

export { LIBRARY } from './calc-engine';

// Calc is jointly owned by Design and Engineering (no separate "requireDepartment" OR-helper
// exists in lib/auth.js — it only checks one department — so this stays local rather than editing
// a shared file). PMs pass canAccessDepartment unconditionally for every department.
export function requireCalcAccess(user) {
  if (canAccessDepartment(user, 'Design') || canAccessDepartment(user, 'Engineering')) return null;
  return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
}

// --- Calc Sheets — project hierarchy (CALC-CHANGES2.md §A) ---------------------------------------

export async function getCalcSheets(projectId) {
  return queryAll('SELECT * FROM calc_sheets WHERE project_id = ? ORDER BY id', [Number(projectId)]);
}

export async function getCalcSheet(sheetId) {
  return queryOne(
    `SELECT s.*, p.project_no, p.customer_name
       FROM calc_sheets s JOIN projects p ON p.id = s.project_id
      WHERE s.id = ?`,
    [Number(sheetId)]
  );
}

// New-sheet creation clones the input/constant/array registry from an existing sheet on the same
// project if one exists (so a second sheet on a project starts from the same base inputs), else
// falls back to any other sheet — otherwise it'd start with zero computed-var rows and every
// existing formula would break for it (see the addFormula comment below on why computeAll needs
// this). Never clones computed values themselves — those get recomputed live.
export async function createCalcSheet(projectId, name, createdBy) {
  const { lastId } = await execute(
    `INSERT INTO calc_sheets (project_id, name, created_by) VALUES (?, ?, ?)`,
    [Number(projectId), name, createdBy || null]
  );
  const sheetId = Number(lastId);

  const templateSheet = await queryOne(
    `SELECT id FROM calc_sheets WHERE project_id = ? AND id != ? ORDER BY id LIMIT 1`,
    [Number(projectId), sheetId]
  ) || await queryOne('SELECT id FROM calc_sheets WHERE id != ? ORDER BY id LIMIT 1', [sheetId]);

  if (templateSheet) {
    const templateVars = await queryAll(
      "SELECT name, type, unit, dimension, value, array_json FROM calc_variables WHERE calc_sheet_id = ? AND type != 'computed'",
      [templateSheet.id]
    );
    for (const v of templateVars) {
      await execute(
        `INSERT INTO calc_variables (calc_sheet_id, name, type, unit, dimension, value, array_json) VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [sheetId, v.name, v.type, v.unit, v.dimension, v.value, v.array_json]
      );
    }
  }
  // One computed-var row per global formula — computeAll's dependency resolution needs the name
  // present in this sheet's own variable list even though the formula itself is shared (see
  // addFormula's comment for why).
  const formulas = await queryAll('SELECT id, output_var, unit FROM calc_formulas');
  for (const f of formulas) {
    await execute(
      `INSERT INTO calc_variables (calc_sheet_id, name, type, unit, formula_id) VALUES (?, ?, 'computed', ?, ?)`,
      [sheetId, f.output_var, f.unit, f.id]
    );
  }
  return sheetId;
}

function shapeFormula(row, versions) {
  return {
    id: row.id,
    name: row.name,
    outputVar: row.output_var,
    unit: row.unit,
    curV: row.cur_v,
    status: row.status,
    source: row.source_standard ? { standard: row.source_standard, clause: row.source_clause, url: row.source_url, edition: row.source_edition } : null,
    // Phase 1.2 — only read by computeAll when this formula lands in a detected cycle; harmless
    // otherwise. Defaults mirror the column defaults in lib/db.js.
    iterationTolerance: row.iteration_tolerance ?? 0.001,
    iterationMax: row.iteration_max ?? 50,
    iterationDamping: row.iteration_damping ?? 1,
    versions: versions.filter((v) => v.formula_id === row.id).map((v) => ({ v: v.v, expr: v.expr, note: v.note, ts: v.ts, guardExpr: v.guard_expr || null })),
  };
}

function shapeTable(row, rowsForTable) {
  return {
    id: row.id,
    name: row.name,
    standard: row.standard,
    xColumn: row.x_column,
    xUnit: row.x_unit,
    columns: JSON.parse(row.columns),
    rows: rowsForTable
      .filter((r) => r.table_id === row.id)
      .sort((a, b) => a.sort_order - b.sort_order)
      .map((r) => ({ id: r.id, x: r.x_value, values: JSON.parse(r.values_json) })),
  };
}

// CALC-CHANGES2.md §A — sheetId scopes Registry (calc_variables), snapshots, and notes (the
// project+sheet-specific data). Formulas/validations/tables/formulaTests/templates stay global —
// shared engineering knowledge referenced by name from any sheet, unchanged by this round.
export async function getCalcState(sheetId) {
  const [varRows, formulaRows, versionRows, validationRows, snapshotRows, tableRows, tableRowRows, testRows, noteRows, templateRows] = await Promise.all([
    queryAll('SELECT * FROM calc_variables WHERE calc_sheet_id = ? ORDER BY id', [sheetId]),
    queryAll('SELECT * FROM calc_formulas ORDER BY id'),
    queryAll('SELECT * FROM calc_formula_versions ORDER BY v'),
    queryAll('SELECT * FROM calc_validations ORDER BY id'),
    queryAll('SELECT * FROM calc_snapshots WHERE calc_sheet_id = ? ORDER BY id DESC', [sheetId]),
    queryAll('SELECT * FROM calc_tables ORDER BY id'),
    queryAll('SELECT * FROM calc_table_rows ORDER BY sort_order'),
    queryAll('SELECT * FROM calc_formula_tests ORDER BY id'),
    queryAll("SELECT * FROM calc_notes WHERE (calc_sheet_id = ? OR entity_type = 'formula') ORDER BY id DESC", [sheetId]),
    queryAll('SELECT * FROM calc_templates ORDER BY id'),
  ]);

  const variables = varRows.map((v) => {
    const arrayData = v.array_json ? JSON.parse(v.array_json) : null;
    return {
      id: v.id, name: v.name, type: v.type, unit: v.unit, value: v.value, formulaId: v.formula_id,
      arrayColumns: arrayData?.columns, arrayRows: arrayData?.rows,
    };
  });
  const formulas = formulaRows.map((f) => shapeFormula(f, versionRows));
  const validations = validationRows.map((v) => ({ id: v.id, name: v.name, expr: v.expr, severity: v.severity, message: v.message }));
  const snapshots = snapshotRows.map((s) => ({
    id: s.id, label: s.label, ts: s.ts, createdBy: s.created_by,
    inputOverride: JSON.parse(s.input_override),
    formulaVersionOverride: JSON.parse(s.formula_version_override),
    results: JSON.parse(s.results),
  }));
  const tables = tableRows.map((t) => shapeTable(t, tableRowRows));
  const formulaTests = testRows.map((t) => ({
    id: t.id, formulaId: t.formula_id, name: t.name, inputs: JSON.parse(t.inputs_json), expectedOutput: t.expected_output, tolerance: t.tolerance,
  }));
  const notes = noteRows.map((n) => ({
    id: n.id, entityType: n.entity_type, entityId: n.entity_id, author: n.author, note: n.note, ts: n.created_at,
  }));
  const templates = templateRows.map((t) => ({
    id: t.id, name: t.name, description: t.description, values: JSON.parse(t.values_json),
  }));

  return { variables, formulas, validations, snapshots, tables, formulaTests, notes, templates };
}

export async function addVariable({ sheetId, name, type, unit, value, columns }) {
  const arrayJson = type === 'array' ? JSON.stringify({ columns: columns || [], rows: [] }) : null;
  const { lastId } = await execute(
    `INSERT INTO calc_variables (calc_sheet_id, name, type, unit, value, array_json) VALUES (?, ?, ?, ?, ?, ?)`,
    [sheetId, name, type, unit || null, type === 'computed' || type === 'array' ? null : Number(value) || 0, arrayJson]
  );
  return Number(lastId);
}

export async function updateVariableValue(id, value) {
  await execute(`UPDATE calc_variables SET value = ? WHERE id = ?`, [Number(value), id]);
}

// Phase 3, item 14 — replaces an array variable's row set, keeping its declared columns (small
// data, read/written whole, same idiom calc_snapshots/calc_tables already use for their JSON blobs).
export async function updateVariableArrayRows(id, rows) {
  const row = await queryOne('SELECT array_json FROM calc_variables WHERE id = ?', [id]);
  const existing = row?.array_json ? JSON.parse(row.array_json) : { columns: [] };
  await execute(`UPDATE calc_variables SET array_json = ? WHERE id = ?`, [JSON.stringify({ columns: existing.columns, rows }), id]);
}

export async function deleteVariable(id) {
  await execute(`DELETE FROM calc_variables WHERE id = ? AND type != 'computed'`, [id]);
}

// Auto-creates any missing variable referenced by a formula import (library import or manual add),
// mirroring the prototype's ensureVariable — skips silently if the name is already registered.
async function ensureVariable(sheetId, name, type, unit) {
  const existing = await queryOne('SELECT id FROM calc_variables WHERE name = ? AND calc_sheet_id = ?', [name, sheetId]);
  if (existing) return existing.id;
  return addVariable({ sheetId, name, type, unit });
}

// CALC-CHANGES2.md §A — Methodology is global but computeAll runs the FULL formula set for every
// sheet (unchanged this round), and a formula's dependency resolution only recognizes a name it can
// find in that sheet's own `variables` list (see extractDeps/computeAll in calc-engine.js). So a new
// formula's computed output variable has to exist on EVERY sheet, not just the one Methodology was
// edited from — otherwise any other sheet's formula referencing this output as a dependency breaks.
// Small loop (a handful of sheets at most), cheapest way to keep every sheet's registry consistent
// with the shared methodology without turning formulas into a per-sheet concept.
export async function addFormula({ name, outputVar, unit = '', expr, status = 'draft', source = null, note = 'Initial version', guardExpr = null }) {
  const { lastId } = await execute(
    `INSERT INTO calc_formulas (name, output_var, unit, cur_v, status, source_standard, source_clause, source_url, source_edition)
     VALUES (?, ?, ?, 1, ?, ?, ?, ?, ?)`,
    [name, outputVar, unit, status, source?.standard || null, source?.clause || null, source?.url || null, source?.edition || null]
  );
  const formulaId = Number(lastId);
  await execute(`INSERT INTO calc_formula_versions (formula_id, v, expr, note, guard_expr) VALUES (?, 1, ?, ?, ?)`, [formulaId, expr, note, guardExpr || null]);
  const sheets = await queryAll('SELECT id FROM calc_sheets');
  for (const sheet of sheets) {
    await ensureVariable(sheet.id, outputVar, 'computed', unit);
    await execute(`UPDATE calc_variables SET formula_id = ?, type = 'computed' WHERE name = ? AND calc_sheet_id = ?`, [formulaId, outputVar, sheet.id]);
  }
  return formulaId;
}

// requiredVars (non-computed) are ensured only on the importing sheet — they're real per-sheet
// inputs, not shared methodology; a sheet cloned from the seed template (§A) already has the common
// ones. addFormula above still backfills the computed output onto every sheet.
export async function importLibraryFormula(sheetId, item) {
  for (const rv of item.requiredVars) {
    if (rv.type !== 'computed') await ensureVariable(sheetId, rv.name, rv.type, rv.unit);
  }
  return addFormula({
    name: item.name, outputVar: item.outputVar, expr: item.expr, status: 'pending',
    source: item.standard ? { standard: item.standard, clause: item.clause, url: item.url, edition: item.edition } : null,
    note: `Imported from Library — ${item.standard} ${item.clause}`,
  });
}

// Editing an approved formula creates a new version and resets status to draft — forces re-approval.
export async function saveFormulaVersion(formulaId, expr, note, guardExpr = null) {
  const formula = await queryOne('SELECT cur_v FROM calc_formulas WHERE id = ?', [formulaId]);
  if (!formula) throw new Error('Formula not found');
  const newV = formula.cur_v + 1;
  await execute(`INSERT INTO calc_formula_versions (formula_id, v, expr, note, guard_expr) VALUES (?, ?, ?, ?, ?)`, [formulaId, newV, expr, note || 'Formula updated', guardExpr || null]);
  await execute(`UPDATE calc_formulas SET cur_v = ?, status = 'draft' WHERE id = ?`, [newV, formulaId]);
}

// Phase 1.4 gate: a formula with failing test cases can't move Draft -> Pending. Approved ->
// anything and Pending -> Draft (etc.) aren't gated — this only blocks a formula from *entering*
// review while it's known to contradict its own worked examples. Re-runs tests against the CURRENT
// live methodology/tables (not just this one formula) via the same runFormulaTests used for the
// Methodology UI's live preview, so "what the UI shows passing" and "what gets enforced" can't drift.
export async function setFormulaStatus(formulaId, status, sheetId) {
  if (status === 'pending') {
    const { variables, formulas, tables, formulaTests } = await getCalcState(sheetId);
    const tests = formulaTests.filter((t) => t.formulaId === Number(formulaId));
    if (tests.length > 0) {
      const results = runFormulaTests(variables, formulas, Number(formulaId), tests, tables);
      const failing = results.filter((r) => !r.pass);
      if (failing.length > 0) {
        const err = new Error(`${failing.length} of ${tests.length} test(s) failing: ${failing.map((f) => f.name).join(', ')}`);
        err.statusCode = 400;
        throw err;
      }
    }
  }
  await execute(`UPDATE calc_formulas SET status = ? WHERE id = ?`, [status, formulaId]);
}

// --- Regression tests (Phase 1.4) ---------------------------------------------------------------

export async function addFormulaTest({ formulaId, name, inputs, expectedOutput, tolerance }) {
  const { lastId } = await execute(
    `INSERT INTO calc_formula_tests (formula_id, name, inputs_json, expected_output, tolerance) VALUES (?, ?, ?, ?, ?)`,
    [formulaId, name, JSON.stringify(inputs), Number(expectedOutput), tolerance != null ? Number(tolerance) : 0.01]
  );
  return Number(lastId);
}

export async function deleteFormulaTest(id) {
  await execute(`DELETE FROM calc_formula_tests WHERE id = ?`, [id]);
}

export async function addValidation({ name, expr, severity, message }) {
  const { lastId } = await execute(
    `INSERT INTO calc_validations (name, expr, severity, message) VALUES (?, ?, ?, ?)`,
    [name, expr, severity, message]
  );
  return Number(lastId);
}

export async function deleteValidation(id) {
  await execute(`DELETE FROM calc_validations WHERE id = ?`, [id]);
}

// Freezes current inputs + the exact formula version pinned per formula + the results computed
// from them, server-side, so "reproduce" later replays the identical calculation regardless of
// what the live methodology looks like by then.
export async function saveSnapshot(sheetId, label, createdBy) {
  const { variables, formulas, tables } = await getCalcState(sheetId);
  const inputOverride = {};
  variables.forEach((v) => { if (v.type !== 'computed') inputOverride[v.name] = v.value; });
  const formulaVersionOverride = {};
  formulas.forEach((f) => { formulaVersionOverride[f.id] = f.curV; });
  const { values } = computeAll(variables, formulas, { formulaVersionOverride, inputOverride, tables });

  const { lastId } = await execute(
    `INSERT INTO calc_snapshots (calc_sheet_id, label, input_override, formula_version_override, results, created_by) VALUES (?, ?, ?, ?, ?, ?)`,
    [sheetId, label, JSON.stringify(inputOverride), JSON.stringify(formulaVersionOverride), JSON.stringify(values), createdBy || null]
  );
  return Number(lastId);
}

// --- Tables (Phase 1.3) -------------------------------------------------------------------------

export async function addTable({ name, standard, xColumn, xUnit, columns }) {
  const { lastId } = await execute(
    `INSERT INTO calc_tables (name, standard, x_column, x_unit, columns) VALUES (?, ?, ?, ?, ?)`,
    [name, standard || null, xColumn, xUnit || null, JSON.stringify(columns)]
  );
  return Number(lastId);
}

export async function deleteTable(id) {
  await execute(`DELETE FROM calc_table_rows WHERE table_id = ?`, [id]);
  await execute(`DELETE FROM calc_tables WHERE id = ?`, [id]);
}

export async function addTableRow(tableId, xValue, values) {
  const count = await queryOne('SELECT COUNT(*) AS n FROM calc_table_rows WHERE table_id = ?', [tableId]);
  const { lastId } = await execute(
    `INSERT INTO calc_table_rows (table_id, x_value, values_json, sort_order) VALUES (?, ?, ?, ?)`,
    [tableId, Number(xValue), JSON.stringify(values), Number(count.n)]
  );
  return Number(lastId);
}

export async function deleteTableRow(id) {
  await execute(`DELETE FROM calc_table_rows WHERE id = ?`, [id]);
}

// --- Engineering notes (Phase 3, item 13) --------------------------------------------------------

// sheetId is only meaningful for entityType='variable' (a variable belongs to one sheet); a
// formula note stays sheet-less, matching Methodology staying global.
export async function addNote({ sheetId, entityType, entityId, author, note }) {
  const { lastId } = await execute(
    `INSERT INTO calc_notes (calc_sheet_id, entity_type, entity_id, author, note) VALUES (?, ?, ?, ?, ?)`,
    [entityType === 'variable' ? sheetId : null, entityType, Number(entityId), author || null, note]
  );
  return Number(lastId);
}

export async function deleteNote(id) {
  await execute(`DELETE FROM calc_notes WHERE id = ?`, [id]);
}

// --- Calculation templates (Phase 3, item 16) ----------------------------------------------------

export async function addTemplate({ name, description, values }) {
  const { lastId } = await execute(
    `INSERT INTO calc_templates (name, description, values_json) VALUES (?, ?, ?)`,
    [name, description || null, JSON.stringify(values)]
  );
  return Number(lastId);
}

export async function deleteTemplate(id) {
  await execute(`DELETE FROM calc_templates WHERE id = ?`, [id]);
}

// Applies a template's saved values to matching non-computed, non-array registry variables by
// exact name — same "update existing, never invent new registry entries" rule the Excel import
// (lib/calc-import.mjs) already follows, for the same reason (a stale/renamed template shouldn't
// silently create junk variables).
export async function applyTemplate(id, sheetId) {
  const tpl = await queryOne('SELECT values_json FROM calc_templates WHERE id = ?', [id]);
  if (!tpl) throw new Error('Template not found');
  const values = JSON.parse(tpl.values_json);
  const variables = await queryAll('SELECT id, name, type FROM calc_variables WHERE calc_sheet_id = ?', [sheetId]);
  const byName = Object.fromEntries(variables.map((v) => [v.name, v]));
  let applied = 0;
  for (const [name, value] of Object.entries(values)) {
    const v = byName[name];
    if (!v || v.type === 'computed' || v.type === 'array') continue;
    await updateVariableValue(v.id, value);
    applied++;
  }
  return applied;
}

// --- Drawings (CALC-CHANGES2.md §B) --------------------------------------------------------------
// Project-scoped, not sheet-scoped — a GA Drawing represents the whole boiler, not one calc sheet.

export async function getCalcDrawings(projectId) {
  const drawings = await queryAll('SELECT * FROM calc_drawings WHERE project_id = ? ORDER BY id', [Number(projectId)]);
  const files = await queryAll(
    `SELECT f.* FROM calc_drawing_files f JOIN calc_drawings d ON d.id = f.drawing_id WHERE d.project_id = ? ORDER BY f.uploaded_at DESC`,
    [Number(projectId)]
  );
  return drawings.map((d) => ({
    id: d.id, projectId: d.project_id, name: d.name, description: d.description, drawingType: d.drawing_type,
    status: d.status, assignedTo: d.assigned_to, dueDate: d.due_date, notes: d.notes, createdAt: d.created_at,
    customerApprovedAt: d.customer_approved_at, customerApprovedBy: d.customer_approved_by,
    customerVisible: !!d.customer_visible, customerVisibleSince: d.customer_visible_since,
    files: files.filter((f) => f.drawing_id === d.id).map((f) => ({
      id: f.id, fileName: f.file_name, fileSize: f.file_size, fileUrl: f.file_url, uploadedBy: f.uploaded_by, uploadedAt: f.uploaded_at,
    })),
  }));
}

export async function addDrawing({ projectId, name, description, drawingType }) {
  const { lastId } = await execute(
    `INSERT INTO calc_drawings (project_id, name, description, drawing_type) VALUES (?, ?, ?, ?)`,
    [Number(projectId), name, description || null, drawingType || null]
  );
  return Number(lastId);
}

const DRAWING_FIELDS = ['name', 'description', 'drawing_type', 'status', 'assigned_to', 'due_date', 'notes', 'customer_visible', 'customer_visible_since', 'customer_notified_at'];
export async function updateDrawing(id, fields) {
  const sets = [];
  const args = [];
  for (const [key, value] of Object.entries(fields)) {
    if (!DRAWING_FIELDS.includes(key)) continue;
    sets.push(`${key} = ?`);
    args.push(value);
  }
  if (!sets.length) return;
  args.push(Number(id));
  await execute(`UPDATE calc_drawings SET ${sets.join(', ')} WHERE id = ?`, args);
}

export async function getDrawingFiles(drawingId) {
  return queryAll('SELECT * FROM calc_drawing_files WHERE drawing_id = ?', [Number(drawingId)]);
}

export async function deleteDrawing(id) {
  await execute(`DELETE FROM calc_drawing_files WHERE drawing_id = ?`, [id]);
  await execute(`DELETE FROM calc_drawing_comments WHERE drawing_id = ?`, [id]);
  await execute(`DELETE FROM calc_drawings WHERE id = ?`, [id]);
}

// --- Drawing comments + customer approval --------------------------------------------------------
// A customer's sign-off is layered on top of Design's own `status` ladder, not merged into it —
// see the schema comment in lib/db.js for why.

export async function getDrawingComments(drawingId) {
  return queryAll('SELECT * FROM calc_drawing_comments WHERE drawing_id = ? ORDER BY created_at', [Number(drawingId)]);
}

export async function addDrawingComment({ drawingId, authorType, authorName, authorUsername, body }) {
  const { lastId } = await execute(
    `INSERT INTO calc_drawing_comments (drawing_id, author_type, author_name, author_username, body) VALUES (?, ?, ?, ?, ?)`,
    [Number(drawingId), authorType, authorName, authorUsername || null, body]
  );
  return Number(lastId);
}

export async function approveDrawing(drawingId, { approvedBy }) {
  await execute(
    `UPDATE calc_drawings SET customer_approved_at = CURRENT_TIMESTAMP, customer_approved_by = ? WHERE id = ?`,
    [approvedBy, Number(drawingId)]
  );
}

// Debounced "a drawing was just shared with you" notification — no cron exists in this app (see
// lib/db.js's customer_visible_since comment), so this runs opportunistically wherever a
// notification poll already happens (getNotifications, lib/data.js) rather than on a timer. Correct
// either way: it only ever fires once customer_visible_since is truly 5+ minutes old, regardless of
// how long the app process has been asleep in between — unlike an in-process interval, which would
// silently miss the window entirely on a host that suspends the process (e.g. Render's free tier).
export async function sweepDrawingNotifications() {
  const due = await queryAll(
    `SELECT id, project_id, name FROM calc_drawings
      WHERE customer_visible = 1 AND customer_visible_since IS NOT NULL
        AND customer_visible_since <= datetime('now', '-5 minutes')
        AND customer_notified_at IS NULL`
  );
  if (!due.length) return;
  const customers = await queryAll("SELECT id, project_ids FROM users WHERE role = 'customer' AND active = 1");
  for (const d of due) {
    const recipients = customers.filter(u => parseProjectIds(u.project_ids).includes(String(d.project_id)));
    // Anchors the notification to the project's Design milestone so getNotifications' existing
    // milestone_id -> project_id join resolves a link, same as every other milestone-based
    // notification — no new notifications column needed for this.
    const milestone = await queryOne("SELECT id FROM milestones WHERE project_id = ? AND milestone_key = 'design'", [d.project_id]);
    for (const u of recipients) {
      await notifyUser(u.id, {
        kind: 'drawing_shared', milestone_id: milestone?.id || null,
        title: 'A drawing is ready for your review', body: d.name,
        dedupe_key: `drawing_shared:${d.id}`, isCustomerRecipient: true,
      });
    }
    await execute('UPDATE calc_drawings SET customer_notified_at = CURRENT_TIMESTAMP WHERE id = ?', [d.id]);
  }
}

export async function addDrawingFile({ drawingId, fileName, fileSize, fileKey, fileUrl, uploadedBy }) {
  const { lastId } = await execute(
    `INSERT INTO calc_drawing_files (drawing_id, file_name, file_size, file_key, file_url, uploaded_by) VALUES (?, ?, ?, ?, ?, ?)`,
    [Number(drawingId), fileName, fileSize || null, fileKey, fileUrl || null, uploadedBy || null]
  );
  return Number(lastId);
}

export async function deleteDrawingFile(id) {
  await execute(`DELETE FROM calc_drawing_files WHERE id = ?`, [id]);
}
