// app/api/items/route.js — read-only search over the Item Master catalog (Group 3 import,
// 2,773 rows). No query surface existed yet (import-only until now). Powers the PR line composer's
// catalog picker (Group 5 Bundle A) — Engineering-gated, same gate the items import itself uses —
// and, since SYSTEM.md §5e's Price Lists round, Sales' quotation-line item picker and Price List
// entry form too.
import { NextResponse } from 'next/server';
import { queryAll } from '@/lib/db';
import { getFreshSessionUser, canAccessDepartment } from '@/lib/auth';

// The PR line composer (Group 5 Bundle A) is shared by Engineering/Design/Stores — same three
// departments as the /pr nav tab. Sales added for the quotation/price-list item pickers — reading
// the catalog to price against it is a different concern from owning it, so this stays a read
// gate, not a write one.
const CATALOG_SEARCH_DEPARTMENTS = ['Engineering', 'Design', 'Stores', 'Sales'];

export async function GET(req) {
  const user = await getFreshSessionUser();
  if (!CATALOG_SEARCH_DEPARTMENTS.some(d => canAccessDepartment(user, d))) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const q = (new URL(req.url).searchParams.get('search') || '').trim();
  if (!q) return NextResponse.json([]);
  const needle = `%${q}%`;
  // group_name added (CALC-CHANGES2.md §F follow-up) — PrWorkspace's ItemSearchField uses it to
  // suggest a §F category (lib/section-shapes.js's taxonomy) on pick, a confident-match-only guess.
  const rows = await queryAll(
    `SELECT id, item_code, item_name, detail_desc, uom, group_name
       FROM items
      WHERE item_name LIKE ? OR item_code LIKE ?
      ORDER BY item_name LIMIT 50`,
    [needle, needle]
  );
  return NextResponse.json(rows);
}
