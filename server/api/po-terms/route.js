// PO Terms and Conditions per company (lib/po-terms.mjs). Read by Procurement, saved by whoever holds
// procurement.po.terms.write (open by default; Settings → Action Permissions can make it Head-only).
import { NextResponse } from 'next/server';
import { execute, queryOne, refreshCompanies } from '@/lib/db';
import { getFreshSessionUser, requireDepartment } from '@/lib/auth';
import { requireAction } from '@/lib/action-permissions';
import { getCompanySettings } from '@/lib/data';
import { cleanPoTerms } from '@/lib/po-terms.mjs';
import { audit } from '@/lib/usb';

export async function GET() {
  const user = await getFreshSessionUser();
  const denied = requireDepartment(user, 'Procurement');
  if (denied) return denied;
  const rows = await getCompanySettings();
  return NextResponse.json(rows.map(r => ({ id: r.id, company: r.company, legal_name: r.legal_name, terms: cleanPoTerms(r.po_terms_json) })));
}

export async function PUT(req) {
  const user = await getFreshSessionUser();
  const denied = requireDepartment(user, 'Procurement') || await requireAction(user, 'Procurement', 'procurement.po.terms.write');
  if (denied) return denied;
  const b = await req.json();
  const row = await queryOne('SELECT id, company FROM company_settings WHERE id = ?', [Number(b.id)]);
  if (!row) return NextResponse.json({ error: 'Company not found' }, { status: 404 });
  const terms = cleanPoTerms(b.terms);
  await execute('UPDATE company_settings SET po_terms_json = ? WHERE id = ?', [JSON.stringify(terms), row.id]);
  await refreshCompanies();
  await audit('po_terms_edit', { actor: user.username, detail: `${row.company}: ${terms.enabled ? 'on' : 'off'}, ${terms.body.length} chars` });
  return NextResponse.json({ ok: true, terms });
}
