// Stores -> WIP, structured (§3.3) — replaces the free-text issued_ref/received_ref on bom_items
// going forward; those columns are untouched for existing rows. Optionally linked to a job card.
// Production can record these too, not just Stores — Production already owns issued_ref/received_ref
// on the BOM itself (BOM_FIELD_OWNERS.Production), so this mirrors an authority that already exists
// rather than inventing a new cross-department rule.
import { NextResponse } from 'next/server';
import { execute, queryAll } from '@/lib/db';
import { getFreshSessionUser, canAccessDepartment } from '@/lib/auth';
import { audit } from '@/lib/usb';

function canIssue(user) {
  return canAccessDepartment(user, 'Stores') || canAccessDepartment(user, 'Production');
}

export async function GET(req) {
  const user = await getFreshSessionUser();
  if (!canIssue(user)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  const params = new URL(req.url).searchParams;
  const bomItemId = params.get('bom_item_id');
  const projectId = params.get('project_id');
  if (bomItemId) {
    return NextResponse.json(await queryAll(
      'SELECT * FROM material_issues WHERE bom_item_id = ? ORDER BY issued_at DESC', [bomItemId]
    ));
  }
  if (projectId) {
    return NextResponse.json(await queryAll(
      `SELECT mi.*, b.material_description, b.moc, b.size_spec
         FROM material_issues mi JOIN bom_items b ON b.id = mi.bom_item_id
        WHERE b.project_id = ? ORDER BY mi.issued_at DESC LIMIT 100`,
      [projectId]
    ));
  }
  return NextResponse.json({ error: 'bom_item_id or project_id is required' }, { status: 400 });
}

export async function POST(req) {
  const user = await getFreshSessionUser();
  if (!canIssue(user)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const b = await req.json();
  const bomItemId = Number(b.bom_item_id);
  const qty = Number(b.qty);
  if (!bomItemId) return NextResponse.json({ error: 'BOM item is required' }, { status: 400 });
  if (!qty || qty <= 0) return NextResponse.json({ error: 'Enter a quantity' }, { status: 400 });

  const { lastId } = await execute(
    `INSERT INTO material_issues (bom_item_id, job_card_id, qty, issued_by, notes) VALUES (?, ?, ?, ?, ?)`,
    [bomItemId, b.job_card_id ? Number(b.job_card_id) : null, qty, user.username, String(b.notes || '').trim() || null]
  );
  await audit('material_issued', { actor: user.username, detail: `bom_item #${bomItemId} · qty ${qty}` });
  return NextResponse.json({ id: Number(lastId) });
}
