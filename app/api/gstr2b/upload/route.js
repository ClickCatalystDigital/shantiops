// app/api/gstr2b/upload/route.js — ACCOUNTING-IMPLEMENTATION-PLAN.md Phase 5, GST compliance
// sub-step. Same two-phase preview/confirm shape as app/api/masters/[type]/import/route.js:
//   POST file + period                  → parse only, return a preview (nothing written)
//   POST file + period + confirm=1      → replace this period's 'upload'-sourced rows, insert every parsed row
// Re-uploading a period is a full replace of its upload rows only — 'manual' rows for the same
// period are untouched, same reasoning as the master-import precedent (periodic re-exports, not
// incremental edits) but scoped to source='upload' so a manual correction someone made isn't
// silently wiped by the next month's habit of re-uploading the same period to double-check it.
import { NextResponse } from 'next/server';
import { execute, queryOne } from '@/lib/db';
import { getFreshSessionUser, requireDepartment } from '@/lib/auth';
import { requireAction } from '@/lib/action-permissions';
import { audit } from '@/lib/usb';
import { parseGstr2b } from '@/lib/gstr2b-import.mjs';
import { COMPANY_NAMES } from '@/lib/qc-doc-pdf.js';

export async function POST(req) {
  const user = await getFreshSessionUser();
  const denied = requireDepartment(user, 'Accounts');
  if (denied) return denied;
  const actionDenied = await requireAction(user, 'Accounts', 'accounts.gstr2b.upload');
  if (actionDenied) return actionDenied;

  const form = await req.formData();
  const file = form.get('file');
  if (!file || typeof file.arrayBuffer !== 'function') {
    return NextResponse.json({ error: 'No file provided' }, { status: 400 });
  }
  const company = COMPANY_NAMES.includes(form.get('company')) ? form.get('company') : COMPANY_NAMES[0];
  const period = form.get('period');
  if (!period) return NextResponse.json({ error: 'period (YYYY-MM) is required' }, { status: 400 });

  const buffer = Buffer.from(await file.arrayBuffer());
  let parsed;
  try {
    parsed = parseGstr2b(buffer);
  } catch (e) {
    return NextResponse.json({ error: `Could not read file: ${e.message}` }, { status: 400 });
  }
  if (parsed.error) return NextResponse.json({ error: parsed.error }, { status: 400 });
  if (!parsed.records.length) return NextResponse.json({ error: 'No B2B invoice rows found in this file' }, { status: 400 });

  const existing = await queryOne(
    "SELECT COUNT(*) AS n FROM gstr2b_lines WHERE company = ? AND period = ? AND source = 'upload'",
    [company, period]
  );

  if (form.get('confirm') !== '1') {
    return NextResponse.json({
      preview: {
        filename: file.name,
        sheetName: parsed.sheetName,
        columns: parsed.columns,
        totalRows: parsed.records.length,
        totalSkipped: parsed.skipped,
        sample: parsed.records.slice(0, 5),
        existingUploadRows: existing.n,
      },
    });
  }

  await execute("DELETE FROM gstr2b_lines WHERE company = ? AND period = ? AND source = 'upload'", [company, period]);
  let n = 0;
  for (const rec of parsed.records) {
    await execute(
      `INSERT INTO gstr2b_lines
         (company, period, source, supplier_gstin, supplier_name, invoice_no, invoice_date, invoice_value,
          taxable_value, igst, cgst, sgst, cess, itc_availability, itc_reason, created_by)
       VALUES (?, ?, 'upload', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [company, period, rec.supplier_gstin, rec.supplier_name, rec.invoice_no, rec.invoice_date, rec.invoice_value,
        rec.taxable_value, rec.igst, rec.cgst, rec.sgst, rec.cess, rec.itc_availability, rec.itc_reason, user.username]
    );
    n++;
  }

  await audit('gstr2b_uploaded', { actor: user.username, detail: `${company} ${period}: ${n} rows (replaced ${existing.n})` });
  return NextResponse.json({ inserted: n, skipped: parsed.skipped, previousUploadRows: existing.n });
}
