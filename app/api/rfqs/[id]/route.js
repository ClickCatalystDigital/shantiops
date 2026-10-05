// app/api/rfqs/[id]/route.js — RFQ detail + per-supplier actions (V2-CHANGES.md Phase 5.1).
import { NextResponse } from 'next/server';
import crypto from 'crypto';
import { execute, queryOne } from '@/lib/db';
import { getFreshSessionUser, requireDepartment } from '@/lib/auth';
import { requireAction } from '@/lib/action-permissions';
import { getRfqDetail } from '@/lib/data';
import { COMPANY_NAMES } from '@/lib/company-profiles';
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
  const actionDenied = await requireAction(user, 'Procurement', 'procurement.rfq.record');
  if (actionDenied) return actionDenied;

  const b = await req.json();

  // { action: 'cancel' } — RFQ-level, not per-supplier, so it's handled before the per-supplier `rs`
  // lookup below. A real user's explicit "get rid of this RFQ" — closes it outright regardless of
  // whether its items are decided (unlike the automatic sibling-aware close in
  // lib/procurement.js's maybeCloseRfqsForItem, this is a deliberate, confirmed action on the one
  // RFQ being looked at). Never deletes rows — just closes it and kills every not-yet-responded
  // supplier's link, so a mistaken RFQ stops showing as active anywhere and can't collect any more
  // quotes, while its history (and any already-submitted quote) stays intact.
  if (b.action === 'cancel') {
    const rfq = await queryOne('SELECT * FROM rfqs WHERE id = ?', [params.id]);
    if (!rfq) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    if (rfq.status === 'closed') return NextResponse.json({ error: 'Already cancelled' }, { status: 400 });
    await execute("UPDATE rfqs SET status = 'closed' WHERE id = ?", [params.id]);
    // A genuine past epoch-ms, not 0 — the public route's guard is `token_expires &&
    // token_expires < Date.now()`, and 0 is falsy, so it would silently skip the expiry check
    // entirely instead of rejecting (caught live: the token stayed usable after "cancelling" it).
    await execute('UPDATE rfq_suppliers SET token_expires = 1 WHERE rfq_id = ? AND responded_at IS NULL', [params.id]);
    await audit('rfq_cancelled', { actor: user.username, detail: `rfq ${params.id}` });
    return NextResponse.json(await getRfqDetail(params.id));
  }

  // Editing after creation: add suppliers, drop a supplier who hasn't quoted, drop an item. A cancelled
  // RFQ can't be edited. Quotes already submitted are never touched (they live in supplier_quotes).
  if (['add_suppliers', 'remove_supplier', 'remove_item', 'set_company'].includes(b.action)) {
    const rfq = await queryOne('SELECT * FROM rfqs WHERE id = ?', [params.id]);
    if (!rfq) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    if (rfq.status === 'closed') return NextResponse.json({ error: 'This RFQ is cancelled' }, { status: 400 });
    if (b.action === 'set_company') {
      if (!COMPANY_NAMES.includes(b.company)) return NextResponse.json({ error: 'Unknown company' }, { status: 400 });
      await execute('UPDATE rfqs SET company = ? WHERE id = ?', [b.company, params.id]);
      await audit('rfq_edited', { actor: user.username, detail: `rfq ${params.id}: company ${b.company}` });
    } else if (b.action === 'add_suppliers') {
      const ids = (Array.isArray(b.supplier_ids) ? b.supplier_ids : []).map(Number).filter(Boolean);
      if (!ids.length) return NextResponse.json({ error: 'Pick at least one supplier' }, { status: 400 });
      let added = 0;
      for (const sid of ids) {
        if (await queryOne('SELECT 1 FROM rfq_suppliers WHERE rfq_id = ? AND supplier_id = ?', [params.id, sid])) continue;
        if (!await queryOne('SELECT 1 FROM suppliers WHERE id = ?', [sid])) continue;
        await execute('INSERT INTO rfq_suppliers (rfq_id, supplier_id, token, token_expires) VALUES (?, ?, ?, ?)',
          [params.id, sid, crypto.randomBytes(24).toString('hex'), Date.now() + TOKEN_TTL_MS]);
        added++;
      }
      await audit('rfq_edited', { actor: user.username, detail: `rfq ${params.id}: +${added} supplier(s)` });
    } else if (b.action === 'remove_supplier') {
      const row = await queryOne('SELECT * FROM rfq_suppliers WHERE rfq_id = ? AND supplier_id = ?', [params.id, b.supplier_id]);
      if (!row) return NextResponse.json({ error: 'Not found' }, { status: 404 });
      if (row.responded_at) return NextResponse.json({ error: 'This supplier has already quoted' }, { status: 409 });
      const { n } = await queryOne('SELECT COUNT(*) AS n FROM rfq_suppliers WHERE rfq_id = ?', [params.id]);
      if (n <= 1) return NextResponse.json({ error: 'An RFQ needs at least one supplier — cancel it instead' }, { status: 400 });
      await execute('DELETE FROM rfq_suppliers WHERE id = ?', [row.id]);
      await audit('rfq_edited', { actor: user.username, detail: `rfq ${params.id}: removed supplier ${b.supplier_id}` });
    } else {
      const { n } = await queryOne('SELECT COUNT(*) AS n FROM rfq_items WHERE rfq_id = ?', [params.id]);
      if (n <= 1) return NextResponse.json({ error: 'An RFQ needs at least one item — cancel it instead' }, { status: 400 });
      const r = await execute('DELETE FROM rfq_items WHERE rfq_id = ? AND bom_item_id = ?', [params.id, Number(b.bom_item_id)]);
      if (!r.changes) return NextResponse.json({ error: 'Item not on this RFQ' }, { status: 404 });
      await audit('rfq_edited', { actor: user.username, detail: `rfq ${params.id}: removed item ${b.bom_item_id}` });
    }
    return NextResponse.json(await getRfqDetail(params.id));
  }

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
