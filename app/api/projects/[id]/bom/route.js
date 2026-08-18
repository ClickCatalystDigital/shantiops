import { NextResponse } from 'next/server';
import { execute, queryAll } from '@/lib/db';
import { getFreshSessionUser, requireDepartment } from '@/lib/auth';

// Engineering (or PM) uploads a flat BOM for a project. Rows: material_description, moc, size_spec
// (Make and IBR No. are NOT on the BOM — the Dispatch head fills those on the packing list, §8).
export async function POST(req, { params }) {
  const denied = requireDepartment(await getFreshSessionUser(), 'Engineering');
  if (denied) return denied;
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
export async function GET(req, { params }) {
  const items = await queryAll(
    `SELECT * FROM bom_items WHERE project_id = ? AND purchase_status IN ('Received', 'In-Stock')
      ORDER BY sort_order, id`, [params.id]
  );
  return NextResponse.json({ items });
}
