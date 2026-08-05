// app/api/items/route.js — read-only search over the Item Master catalog (Group 3 import,
// 2,773 rows). No query surface existed yet (import-only until now). Powers the PR line composer's
// catalog picker (Group 5 Bundle A) — Engineering-gated, same gate the items import itself uses.
import { NextResponse } from 'next/server';
import { queryAll } from '@/lib/db';
import { getSessionUser, canAccessDepartment } from '@/lib/auth';

// The PR line composer (Group 5 Bundle A) is shared by Engineering/Design/Stores — same three
// departments as the /pr nav tab — not just Engineering's own items-import gate.
const PR_DEPARTMENTS = ['Engineering', 'Design', 'Stores'];

export async function GET(req) {
  const user = getSessionUser();
  if (!PR_DEPARTMENTS.some(d => canAccessDepartment(user, d))) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const q = (new URL(req.url).searchParams.get('search') || '').trim();
  if (!q) return NextResponse.json([]);
  const needle = `%${q}%`;
  const rows = await queryAll(
    `SELECT id, item_code, item_name, detail_desc, uom
       FROM items
      WHERE item_name LIKE ? OR item_code LIKE ?
      ORDER BY item_name LIMIT 50`,
    [needle, needle]
  );
  return NextResponse.json(rows);
}
