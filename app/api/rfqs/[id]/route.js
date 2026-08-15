// app/api/rfqs/[id]/route.js — RFQ detail + per-supplier actions (V2-CHANGES.md Phase 5.1).
import { NextResponse } from 'next/server';
import crypto from 'crypto';
import { execute, queryOne } from '@/lib/db';
import { getFreshSessionUser, requireDepartment } from '@/lib/auth';
import { getRfqDetail } from '@/lib/data';
import { audit } from '@/lib/usb';

const TOKEN_TTL_MS = 14 * 24 * 60 * 60 * 1000;

export async function GET(req, { params }) {
  const user = await getFreshSessionUser();
  const denied = requireDepartment(user, 'Procurement');
  if (denied) return denied;
  const detail = await getRfqDetail(params.id);
  if (!detail) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  return NextResponse.json(detail);
}

// { supplier_id, action: 'sent' } — fire-and-forget stamp from the WhatsApp/Email button click.
// { supplier_id, action: 'resend' } — D12: re-send issues a fresh token, doesn't reuse/extend the old one.
export async function PATCH(req, { params }) {
  const user = await getFreshSessionUser();
  const denied = requireDepartment(user, 'Procurement');
  if (denied) return denied;

  const b = await req.json();
  const rs = await queryOne('SELECT * FROM rfq_suppliers WHERE rfq_id = ? AND supplier_id = ?', [params.id, b.supplier_id]);
  if (!rs) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  if (b.action === 'sent') {
    await execute('UPDATE rfq_suppliers SET sent_at = CURRENT_TIMESTAMP WHERE id = ?', [rs.id]);
    await execute("UPDATE rfqs SET status = 'sent' WHERE id = ? AND status = 'draft'", [params.id]);
    return NextResponse.json({ ok: true });
  }

  if (b.action === 'resend') {
    const token = crypto.randomBytes(24).toString('hex');
    await execute(
      'UPDATE rfq_suppliers SET token = ?, token_expires = ?, sent_at = NULL, responded_at = NULL WHERE id = ?',
      [token, Date.now() + TOKEN_TTL_MS, rs.id]
    );
    await audit('rfq_resent', { actor: user.username, detail: `rfq ${params.id}, supplier ${b.supplier_id}` });
    const detail = await getRfqDetail(params.id);
    return NextResponse.json(detail);
  }

  return NextResponse.json({ error: 'Unknown action' }, { status: 400 });
}
