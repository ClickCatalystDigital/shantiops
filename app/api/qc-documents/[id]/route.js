import { NextResponse } from 'next/server';
import { execute, queryOne } from '@/lib/db';
import { getFreshSessionUser, requireDepartment } from '@/lib/auth';
import { requireAction } from '@/lib/action-permissions';
import { audit } from '@/lib/usb';
import { notifyProjectCustomers } from '@/lib/notify';
import { COMPANY_NAMES } from '@/lib/qc-doc-pdf.js';
import { QC_HEADER_FIELDS } from '@/lib/qc-document-fields';

const EDITABLE = [...QC_HEADER_FIELDS.map(f => f.key), 'manifest_extra'];
const REQUIRED_KEYS = new Set(QC_HEADER_FIELDS.filter(f => f.required).map(f => f.key));
const FIELD_LABEL = Object.fromEntries(QC_HEADER_FIELDS.map(f => [f.key, f.label]));

// Editing the boiler-level header fields (the "edit" link on the Boiler details card) — the part
// table and its certificate links have their own endpoint (link-parts), not this one.
export async function PATCH(req, { params }) {
  const user = await getFreshSessionUser();
  const denied = requireDepartment(user, 'QC');
  if (denied) return denied;
  const actionDenied = await requireAction(user, 'QC', 'qc.document.write');
  if (actionDenied) return actionDenied;

  const doc = await queryOne('SELECT id, project_id, doc_id, customer_visible FROM qc_documents WHERE id = ?', [params.id]);
  if (!doc) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const b = await req.json();
  const keys = Object.keys(b).filter(k => EDITABLE.includes(k) || k === 'customer_visible');
  if (!keys.length) return NextResponse.json({ error: 'No fields to update' }, { status: 400 });
  if (keys.includes('customer_visible') && b.customer_visible) {
    // Same hard gate the PDF route enforces — a document can only go in front of the customer once
    // it's actually complete, not partway through being built (§6 investigation). Zero parts is not
    // "complete" even though it's vacuously zero unlinked — a document must have actually certified
    // something.
    const counts = await queryOne(
      `SELECT COUNT(*) AS total, SUM(CASE WHEN test_certificate_id IS NULL THEN 1 ELSE 0 END) AS unlinked
         FROM qc_document_parts WHERE document_id = ?`, [params.id]);
    if (!counts.total) {
      return NextResponse.json({ error: 'This document has no parts yet' }, { status: 409 });
    }
    if (counts.unlinked > 0) {
      return NextResponse.json({ error: `${counts.unlinked} part${counts.unlinked === 1 ? '' : 's'} still need${counts.unlinked === 1 ? 's' : ''} a certificate` }, { status: 409 });
    }
  }
  // The UI gate (lib/qc-document-fields.js's `required`) is never the real enforcement. A partial
  // update that simply omits a required field is fine (`keys` won't include it) — this only rejects
  // a request that explicitly tries to blank one out.
  for (const k of keys) {
    if (REQUIRED_KEYS.has(k) && !String(b[k] || '').trim()) {
      return NextResponse.json({ error: `${FIELD_LABEL[k]} cannot be empty` }, { status: 400 });
    }
  }
  if (keys.includes('company') && !COMPANY_NAMES.includes(b.company)) {
    return NextResponse.json({ error: 'Unknown company' }, { status: 400 });
  }

  const changed = {};
  for (const k of keys) {
    if (k === 'customer_visible') { changed.customer_visible = b.customer_visible ? 1 : 0; continue; }
    let v = typeof b[k] === 'string' ? b[k].trim() : b[k];
    if (v === '') v = null;
    changed[k] = v;
  }
  if ('customer_visible' in changed) changed.customer_visible_at = changed.customer_visible ? new Date().toISOString() : null;
  await execute(
    `UPDATE qc_documents SET ${Object.keys(changed).map(k => `${k} = ?`).join(', ')} WHERE id = ?`,
    [...Object.values(changed), params.id]);

  // Real 0->1 flip only — not every PATCH, and not a re-save while already shared.
  if (changed.customer_visible === 1 && !doc.customer_visible) {
    await notifyProjectCustomers(doc.project_id, {
      kind: 'qc_document_shared',
      title: 'A QC certificate is ready',
      body: `${doc.doc_id} has been shared with you`,
      dedupe_key: `qc_document_shared:${doc.id}`,
    });
  }
  return NextResponse.json({ ok: true });
}

// Deletes the document and its part rows explicitly rather than relying on the schema's
// ON DELETE CASCADE — this app never turns SQLite foreign-key enforcement on for plain
// execute() calls, so the constraint alone wouldn't actually remove the child rows.
export async function DELETE(req, { params }) {
  const user = await getFreshSessionUser();
  const denied = requireDepartment(user, 'QC');
  if (denied) return denied;
  const actionDenied = await requireAction(user, 'QC', 'qc.document.delete');
  if (actionDenied) return actionDenied;

  const doc = await queryOne('SELECT id, doc_id, project_id FROM qc_documents WHERE id = ?', [params.id]);
  if (!doc) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  await execute('DELETE FROM qc_document_parts WHERE document_id = ?', [params.id]);
  await execute('DELETE FROM qc_mountings WHERE document_id = ?', [params.id]);
  await execute('DELETE FROM qc_documents WHERE id = ?', [params.id]);

  await audit('qc_document_delete', {
    actor: user.username,
    detail: JSON.stringify({ qc_document_id: Number(params.id), project_id: doc.project_id, doc_id: doc.doc_id }),
  });
  return NextResponse.json({ ok: true });
}
