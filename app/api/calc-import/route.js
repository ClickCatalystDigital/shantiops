import { NextResponse } from 'next/server';
import { getSessionUser } from '@/lib/auth';
import { requireCalcAccess, getCalcState, updateVariableValue } from '@/lib/calc';
import { audit } from '@/lib/usb';
import { parseVariableValues } from '@/lib/calc-import.mjs';

// Same two-phase shape as app/api/masters/[type]/import/route.js: parse -> preview (nothing
// written) -> re-post with confirm=1 -> apply. Unlike the masters import, this never replaces a
// table — it only patches the `value` of variables matched by exact name, and only non-computed
// ones (a computed variable's value comes from its formula, not an import).
export async function POST(req) {
  const user = getSessionUser();
  const denied = requireCalcAccess(user);
  if (denied) return denied;

  const form = await req.formData();
  const file = form.get('file');
  if (!file || typeof file.arrayBuffer !== 'function') {
    return NextResponse.json({ error: 'No .xlsx file provided' }, { status: 400 });
  }
  const sheetId = form.get('sheetId');
  if (!sheetId) return NextResponse.json({ error: 'sheetId is required' }, { status: 400 });
  const buffer = Buffer.from(await file.arrayBuffer());

  let parsed;
  try {
    parsed = parseVariableValues(buffer);
  } catch (e) {
    return NextResponse.json({ error: `Could not read workbook: ${e.message}` }, { status: 400 });
  }
  if (parsed.error) return NextResponse.json({ error: parsed.error }, { status: 400 });
  if (!parsed.records.length) return NextResponse.json({ error: 'No Name/Value rows found in this workbook' }, { status: 400 });

  const { variables } = await getCalcState(sheetId);
  const byName = Object.fromEntries(variables.map((v) => [v.name, v]));

  const matched = [];
  const skippedComputed = [];
  const unmatched = [];
  for (const rec of parsed.records) {
    const v = byName[rec.name];
    if (!v) { unmatched.push(rec.name); continue; }
    if (v.type === 'computed') { skippedComputed.push(rec.name); continue; }
    matched.push({ id: v.id, name: v.name, unit: v.unit, oldValue: v.value, newValue: rec.value });
  }

  const confirm = form.get('confirm') === '1';
  if (!confirm) {
    return NextResponse.json({
      preview: {
        filename: file.name, sheetName: parsed.sheetName, totalRows: parsed.records.length, totalSkipped: parsed.skipped,
        matched, skippedComputed, unmatched,
      },
    });
  }

  for (const m of matched) await updateVariableValue(m.id, m.newValue);
  await audit('calc_values_imported', { actor: user.username, detail: `${matched.length} variable(s) from ${file.name}` });
  return NextResponse.json({ updated: matched.length, skippedComputed: skippedComputed.length, unmatched: unmatched.length });
}
