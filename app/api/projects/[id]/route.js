import { NextResponse } from 'next/server';
import { execute } from '@/lib/db';
import { getFreshSessionUser } from '@/lib/auth';
import { requireCalcAccess } from '@/lib/calc';
import { audit } from '@/lib/usb';
import { COMPANY_NAMES } from '@/lib/qc-doc-pdf.js';

// Rename a project's identity (project_no / customer_name) — used e.g. when a demo/seed project
// is repurposed into a real one instead of creating a duplicate. Gated the same as the rest of
// Calc Sheets (Design/Engineering/PM) rather than requirePM's stricter manager-tier-only check —
// renaming a project's number/customer here is a Calc-workspace action, not a PM project-creation one.
export async function PATCH(req, { params }) {
  const user = await getFreshSessionUser();
  const denied = requireCalcAccess(user);
  if (denied) return denied;

  const b = await req.json();
  const fields = [];
  const args = [];
  if (b.project_no !== undefined) { fields.push('project_no = ?'); args.push(String(b.project_no).trim()); }
  if (b.customer_name !== undefined) { fields.push('customer_name = ?'); args.push(String(b.customer_name).trim()); }
  if (b.description !== undefined) { fields.push('description = ?'); args.push(b.description || null); }
  if (b.company !== undefined) {
    if (!COMPANY_NAMES.includes(b.company)) return NextResponse.json({ error: 'Invalid company' }, { status: 400 });
    fields.push('company = ?'); args.push(b.company);
  }
  if (!fields.length) return NextResponse.json({ error: 'Nothing to update' }, { status: 400 });

  args.push(params.id);
  try {
    await execute(`UPDATE projects SET ${fields.join(', ')} WHERE id = ?`, args);
  } catch (e) {
    if (String(e).includes('UNIQUE')) return NextResponse.json({ error: `Project ${b.project_no} already exists` }, { status: 409 });
    throw e;
  }
  await audit('project_renamed', { actor: user.username, detail: `project ${params.id} -> ${b.project_no || ''}` });
  return NextResponse.json({ ok: true });
}
