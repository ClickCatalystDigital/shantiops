import { NextResponse } from 'next/server';
import { execute, queryAll } from '@/lib/db';
import { getFreshSessionUser, canAccessDepartment, isInternal } from '@/lib/auth';
import { getProjectBom } from '@/lib/data';

// Engineering or Design (or PM) uploads a flat BOM for a project — Design got the same BOM-entry
// capability as Engineering (2026-08-25). Rows: material_description, moc, size_spec (Make and IBR
// No. are NOT on the BOM — the Dispatch head fills those on the packing list, §8).
export async function POST(req, { params }) {
  const user = await getFreshSessionUser();
  if (!canAccessDepartment(user, 'Engineering') && !canAccessDepartment(user, 'Design')) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }
  const { rows } = await req.json();
  if (!Array.isArray(rows) || !rows.length) {
    return NextResponse.json({ error: 'No BOM rows provided' }, { status: 400 });
  }
  let n = 0;
  for (const r of rows) {
    if (!r.material_description?.trim()) continue;
    await execute(
      'INSERT INTO bom_items (project_id, material_description, moc, size_spec, sort_order) VALUES (?, ?, ?, ?, ?)',
      [params.id, r.material_description.trim(), r.moc || null, r.size_spec || null, n]
    );
    n++;
  }
  return NextResponse.json({ inserted: n });
}

// Only Production's Job Card BOM tab and Stores' Material-Issued-to-WIP tab call this route
// (components/WorkersPanel.jsx, components/StoresWorkspace.jsx) — both need exactly the same
// answer: what's actually arrived and can be worked with. purchase_status IN (Received, In-Stock)
// is the existing "Stores has it in hand" signal, no new field needed. The project page's own
// Master BOM view (all statuses, all departments) goes through lib/data.js's getProjectBom
// instead and is unaffected by this gate.
//
// Cutting & Remnant Management adds a second, independent way in: a line lib/remnant-match.js
// reserved a physical piece against is also "in hand" (the piece is sitting in Stores' stock right
// now) even though purchase_status hasn't moved — that only happens once Production actually cuts
// it (lib/stock-pieces.js's cutPiece sets it to In-Stock). Using purchase_status itself for this
// would hide the line from Stores' Open Requests (getOpenBomItems excludes Received/In-Stock) at
// the same moment Production needs to see it — the two lists are meant to be mutually exclusive by
// status, so the reservation state has to live outside that column instead.
// `?all=1` — every status, every source (Release BOM tab's manageable table: templates, PRs, and
// hand-added lines all together, searchable/editable/deletable via the same BomTable everywhere
// else already uses). Reuses getProjectBom (the project page's own Master BOM read) instead of a
// second query shape — the only new thing here is the query-param branch, not new data-fetching
// logic. Gated (the narrow default below has no auth check today, a pre-existing gap out of scope
// here — not widening it further, just not leaving the new richer branch open too).
export async function GET(req, { params }) {
  const all = new URL(req.url).searchParams.get('all');
  if (all) {
    const user = await getFreshSessionUser();
    if (!isInternal(user)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    return NextResponse.json({ items: (await getProjectBom(params.id)).bom });
  }
  const items = await queryAll(
    `SELECT b.*,
            (SELECT COUNT(*) FROM stock_pieces sp WHERE sp.bom_item_id = b.id AND sp.status = 'reserved') AS reserved_piece_count,
            it.item_code AS catalog_item_code, dw.name AS drawing_name, dw.revision AS drawing_revision
       FROM bom_items b
       LEFT JOIN items it ON it.id = b.item_id
       LEFT JOIN calc_drawings dw ON dw.id = b.drawing_id
      WHERE b.project_id = ? AND (
       b.purchase_status IN ('Received', 'In-Stock')
       OR EXISTS (SELECT 1 FROM stock_pieces sp WHERE sp.bom_item_id = b.id AND sp.status = 'reserved')
     ) ORDER BY b.sort_order, b.id`, [params.id]
  );
  return NextResponse.json({ items });
}
