// app/api/company-settings/route.js — one row per legal entity (ACCOUNTING-IMPLEMENTATION-PLAN.md
// Phase 0; Company Entities, 2026-08-22). Same shape as app/api/statutory-rates/route.js, keyed by
// row id instead of singleton.
import { NextResponse } from 'next/server';
import { execute, withTransaction, seedChartOfAccountsForCompany } from '@/lib/db';
import { getFreshSessionUser, requireDepartment } from '@/lib/auth';
import { requireAction } from '@/lib/action-permissions';
import { getCompanySettings } from '@/lib/data';
import { audit } from '@/lib/usb';

export async function GET() {
  const user = await getFreshSessionUser();
  const denied = requireDepartment(user, 'Accounts');
  if (denied) return denied;
  return NextResponse.json(await getCompanySettings());
}

// Onboarding a new company (legal entity). Pure INSERT — never touches an existing company_settings
// row — plus seeding its Chart of Accounts immediately (seedChartOfAccountsForCompany, lib/db.js),
// so a runtime-created company doesn't sit with zero accounts until the next process restart.
export async function POST(req) {
  const user = await getFreshSessionUser();
  const denied = requireDepartment(user, 'Accounts');
  if (denied) return denied;
  const actionDenied = await requireAction(user, 'Accounts', 'accounts.company.create');
  if (actionDenied) return actionDenied;

  const b = await req.json();
  const company = String(b.company || '').trim();
  const legalName = String(b.legal_name || '').trim();
  if (!company || !legalName) return NextResponse.json({ error: 'company and legal_name are required' }, { status: 400 });

  let id;
  try {
    id = await withTransaction(async (tx) => {
      const res = await tx.execute({
        sql: `INSERT INTO company_settings (company, legal_name, gstin, pan, registered_address, state, state_code, invoice_prefix)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        args: [company, legalName, b.gstin || null, b.pan || null, b.registered_address || null, b.state || null, b.state_code || null, b.invoice_prefix || null],
      });
      const newId = Number(res.lastInsertRowid);
      await seedChartOfAccountsForCompany(tx, company);
      return newId;
    });
  } catch (e) {
    if (String(e.message || '').includes('UNIQUE')) {
      return NextResponse.json({ error: `A company named "${company}" already exists` }, { status: 409 });
    }
    throw e;
  }

  await audit('company_created', { actor: user.username, detail: company });
  return NextResponse.json({ ok: true, id }, { status: 201 });
}

// A hand edit to any provenance-tracked field flips that field's source to 'manual' and stamps
// updated_at — this is what protects it from a later GSTIN refresh silently overwriting it
// (lib/company-entity.mjs's diffCompanyEntity() treats a 'manual' source as a conflict, never
// auto-applied). `state`/`state_code` share one `state_source` — they never diverge independently.
const TRACKED = ['legal_name', 'gstin', 'pan', 'trade_name', 'gst_status', 'gst_taxpayer_type', 'gst_registration_date', 'gst_constitution'];
const PLAIN = ['registered_address', 'invoice_prefix'];
// PF/ESI/PT: no source tracking (always manual — no fetch path exists for these), just a timestamp.
const APPLICABILITY = [
  ['pf_applicable_override', 'pf_updated_at'], ['pf_establishment_code', 'pf_updated_at'],
  ['esi_applicable_override', 'esi_updated_at'], ['esi_employer_code', 'esi_updated_at'],
  ['pt_applicable_override', 'pt_updated_at'], ['pt_registration_no', 'pt_updated_at'],
];

export async function PATCH(req) {
  const user = await getFreshSessionUser();
  const denied = requireDepartment(user, 'Accounts');
  if (denied) return denied;
  const actionDenied = await requireAction(user, 'Accounts', 'accounts.company_settings.write');
  if (actionDenied) return actionDenied;
  const b = await req.json();
  if (!b.id) return NextResponse.json({ error: 'id required' }, { status: 400 });
  const fields = [];
  const args = [];
  const now = new Date().toISOString();

  for (const key of PLAIN) {
    if (b[key] !== undefined) { fields.push(`${key} = ?`); args.push(b[key]); }
  }
  for (const key of TRACKED) {
    if (b[key] !== undefined) { fields.push(`${key} = ?`, `${key}_source = ?`, `${key}_updated_at = ?`); args.push(b[key], 'manual', now); }
  }
  if (b.state !== undefined && b.state_code !== undefined) {
    fields.push('state = ?', 'state_code = ?', 'state_source = ?', 'state_updated_at = ?');
    args.push(b.state, b.state_code, 'manual', now);
  }
  const stampedTimestamps = new Set();
  for (const [key, tsKey] of APPLICABILITY) {
    if (b[key] === undefined) continue;
    fields.push(`${key} = ?`); args.push(key.endsWith('_override') && b[key] !== null ? (b[key] ? 1 : 0) : b[key]);
    if (!stampedTimestamps.has(tsKey)) { fields.push(`${tsKey} = ?`); args.push(now); stampedTimestamps.add(tsKey); }
  }

  if (!fields.length) return NextResponse.json({ error: 'No fields to update' }, { status: 400 });
  args.push(b.id);
  await execute(`UPDATE company_settings SET ${fields.join(', ')} WHERE id = ?`, args);
  return NextResponse.json({ ok: true });
}
