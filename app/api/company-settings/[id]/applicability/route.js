// app/api/company-settings/[id]/applicability/route.js — Company Entities. PF/ESI/Professional Tax
// applicability, computed in Shanti Ops (lib/company-entity.mjs's computeApplicability()) from data
// already here (employee headcount, professional_tax_slabs) — never fetched, never delegated to
// statutory-rates-hub. Read-only; overrides/registration numbers are written via the existing
// PATCH /api/company-settings.
import { NextResponse } from 'next/server';
import { queryOne } from '@/lib/db';
import { getFreshSessionUser, requireDepartment } from '@/lib/auth';
import { getCompanyApplicabilityInputs } from '@/lib/data';
import { computeApplicability } from '@/lib/company-entity.mjs';

export async function GET(req, { params }) {
  const user = await getFreshSessionUser();
  const denied = requireDepartment(user, 'Accounts');
  if (denied) return denied;

  const row = await queryOne('SELECT company, state, pf_applicable_override, esi_applicable_override, pt_applicable_override FROM company_settings WHERE id = ?', [params.id]);
  if (!row) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const inputs = await getCompanyApplicabilityInputs(row.company, row.state);
  const overrides = {
    pf: row.pf_applicable_override === null ? null : !!row.pf_applicable_override,
    esi: row.esi_applicable_override === null ? null : !!row.esi_applicable_override,
    pt: row.pt_applicable_override === null ? null : !!row.pt_applicable_override,
  };
  return NextResponse.json(computeApplicability({ ...inputs, overrides }));
}
