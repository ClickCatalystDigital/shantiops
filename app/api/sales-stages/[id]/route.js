// app/api/sales-stages/[id]/route.js — Sales CRM plan 3d. A Sales Head (or PM) sets a funnel
// stage's win probability; blank clears it back to the default rule (lib/lead-stage.mjs).
import { NextResponse } from 'next/server';
import { execute, queryOne } from '@/lib/db';
import { getFreshSessionUser, isDepartmentHead } from '@/lib/auth';
import { audit } from '@/lib/usb';

export async function PATCH(req, { params }) {
  const user = await getFreshSessionUser();
  if (!isDepartmentHead(user, 'Sales')) return NextResponse.json({ error: 'Only a Sales Head can change stage probabilities' }, { status: 403 });
  const stage = await queryOne('SELECT id, name, probability_pct FROM sales_stages WHERE id = ?', [params.id]);
  if (!stage) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  const b = await req.json();
  let pct = null;
  if (b.probability_pct !== null && b.probability_pct !== '' && b.probability_pct !== undefined) {
    pct = Number(b.probability_pct);
    if (!Number.isInteger(pct) || pct < 0 || pct > 100) return NextResponse.json({ error: 'Probability must be a whole number from 0 to 100' }, { status: 400 });
  }
  await execute('UPDATE sales_stages SET probability_pct = ? WHERE id = ?', [pct, params.id]);
  await audit('sales_stage_probability', { actor: user.username, detail: `${stage.name}: ${stage.probability_pct ?? 'default'} → ${pct ?? 'default'}` });
  return NextResponse.json({ ok: true });
}
