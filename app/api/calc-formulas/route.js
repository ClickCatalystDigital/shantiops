import { NextResponse } from 'next/server';
import { getFreshSessionUser } from '@/lib/auth';
import { requireCalcAccess, addFormula, importLibraryFormula, LIBRARY } from '@/lib/calc';
import { queryAll } from '@/lib/db';
import { audit } from '@/lib/usb';

export async function GET() {
  const user = await getFreshSessionUser();
  const denied = requireCalcAccess(user);
  if (denied) return denied;
  const formulas = await queryAll('SELECT id, name, output_var AS outputVar FROM calc_formulas ORDER BY id');
  return NextResponse.json({ formulas });
}

export async function POST(req) {
  const user = await getFreshSessionUser();
  const denied = requireCalcAccess(user);
  if (denied) return denied;

  const b = await req.json();

  if (b.libraryId) {
    const item = LIBRARY.find((l) => l.id === b.libraryId);
    if (!item) return NextResponse.json({ error: 'Unknown library formula' }, { status: 400 });
    if (!b.sheetId) return NextResponse.json({ error: 'sheetId is required' }, { status: 400 });
    const id = await importLibraryFormula(b.sheetId, item);
    await audit('calc_formula_imported', { actor: user.username, detail: item.name });
    return NextResponse.json({ id });
  }

  const name = String(b.name || '').trim();
  const outputVar = String(b.outputVar || '').trim();
  const expr = String(b.expr || '').trim();
  if (!name || !outputVar || !expr) return NextResponse.json({ error: 'Name, output variable, and expression are required' }, { status: 400 });

  const standard = String(b.standard || '').trim();
  const source = standard ? { standard, clause: String(b.clause || '').trim() || null, edition: String(b.edition || '').trim() || null, url: null } : null;
  const id = await addFormula({ name, outputVar, expr, unit: b.unit || '', source });
  await audit('calc_formula_created', { actor: user.username, detail: name });
  return NextResponse.json({ id });
}
