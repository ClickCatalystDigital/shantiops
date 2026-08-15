// app/api/opportunities/[id]/route.js — V3_CHANGES.md A4. PATCH covers both the Kanban
// drag-and-drop (stage only) and a full field edit, same single-route shape as
// app/api/milestones/[id]/stages/[stageId]/route.js's status-change endpoint.
import { NextResponse } from 'next/server';
import { execute, queryOne, queryAll } from '@/lib/db';
import { getFreshSessionUser, canAccessDepartment } from '@/lib/auth';
import { audit } from '@/lib/usb';

const PIPELINE_DEPARTMENTS = ['Sales', 'Marketing'];

function canAccessPipeline(user) {
  return PIPELINE_DEPARTMENTS.some(d => canAccessDepartment(user, d));
}

// V3_CHANGES.md §12 decision 5 — DB-configurable stages, see app/api/opportunities/route.js.
async function isValidStage(name) {
  const rows = await queryAll('SELECT 1 FROM sales_stages WHERE name = ? AND active = 1', [name]);
  return rows.length > 0;
}

export async function PATCH(req, { params }) {
  const user = await getFreshSessionUser();
  if (!canAccessPipeline(user)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const { id } = params;
  const existing = await queryOne('SELECT * FROM opportunities WHERE id = ?', [id]);
  if (!existing) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  if (!canAccessDepartment(user, existing.owner_dept)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const b = await req.json();
  const fields = [];
  const args = [];
  if (b.stage !== undefined) {
    if (!await isValidStage(b.stage)) return NextResponse.json({ error: 'Invalid stage' }, { status: 400 });
    fields.push('stage = ?'); args.push(b.stage);
  }
  if (b.title !== undefined) { fields.push('title = ?'); args.push(String(b.title).trim()); }
  if (b.customer_id !== undefined) { fields.push('customer_id = ?'); args.push(b.customer_id || null); }
  if (b.customer_name !== undefined) { fields.push('customer_name = ?'); args.push(b.customer_name || null); }
  if (b.value_num !== undefined) { fields.push('value_num = ?'); args.push(b.value_num || null); }
  if (b.probability !== undefined) { fields.push('probability = ?'); args.push(b.probability || null); }
  if (b.expected_close !== undefined) { fields.push('expected_close = ?'); args.push(b.expected_close || null); }
  if (b.campaign_id !== undefined) { fields.push('campaign_id = ?'); args.push(b.campaign_id || null); }
  if (b.notes !== undefined) { fields.push('notes = ?'); args.push(b.notes || null); }
  if (b.source !== undefined) { fields.push('source = ?'); args.push(b.source || null); }
  if (b.lost_reason !== undefined) { fields.push('lost_reason = ?'); args.push(b.lost_reason || null); }
  if (b.next_contact_date !== undefined) { fields.push('next_contact_date = ?'); args.push(b.next_contact_date || null); }
  if (!fields.length) return NextResponse.json({ error: 'No fields to update' }, { status: 400 });

  fields.push("updated_at = CURRENT_TIMESTAMP");
  args.push(id);
  await execute(`UPDATE opportunities SET ${fields.join(', ')} WHERE id = ?`, args);
  await audit('opportunity_updated', { actor: user.username, detail: `#${id}: ${fields.join(',')}` });
  return NextResponse.json({ ok: true });
}
