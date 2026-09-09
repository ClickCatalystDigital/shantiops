// app/api/item-master/route.js — Engineering's own Item Master maintenance surface (the catalog
// this whole session's audit round worked against, see SYSTEM.md's Item Master sections). Separate
// from the existing GET /api/items (the typeahead search Engineering/Design/Stores/Sales' pickers
// already use, top-50, fixed field subset) — that route's contract stays untouched; this one is the
// paginated, full-field, sortable list the management UI needs, plus create/edit.
import { NextResponse } from 'next/server';
import { queryAll, queryOne, execute } from '@/lib/db';
import { getFreshSessionUser } from '@/lib/auth';
import { requireEngineeringAction } from '@/lib/action-permissions';
import { audit } from '@/lib/usb';
import { CATEGORY_LABEL } from '@/lib/section-shapes';
import { normalizeWords } from '@/lib/match-utils';

const PAGE_SIZE = 50;
const SEARCH_FIELDS = ['item_name', 'item_code', 'category', 'group_name', 'hsn_code', 'detail_desc'];
const SORTABLE = new Set(['item_code', 'item_name', 'category', 'bom_category', 'uom', 'material_process_type', 'item_type']);
const NUMERIC_FIELDS = ['cqty', 'cfactor', 'min_qty', 'max_qty', 'lead_time', 'tolerance_plus', 'tolerance_minus', 'hsn_item_pct'];
// Every column a create/edit is allowed to touch. item_code/id/created_at are deliberately excluded
// — item_code is server-generated once and immutable after that (see POST below); id/created_at are
// never client-settable.
const EDITABLE_FIELDS = [
  'item_name', 'category', 'bom_category', 'group_name', 'main_group', 'sub_group', 'group_code',
  'detail_desc', 'drg_no', 'drg_rev', 'part_no', 'uom', 'cqty', 'cfactor', 'conv_uom',
  'material_process_type', 'item_type', 'min_qty', 'max_qty', 'lead_time', 'tolerance_plus',
  'tolerance_minus', 'class', 'store_location', 'bin_no', 'hsn_code', 'hsn_desc', 'hsn_item_pct',
  'default_requires_heat_no', 'default_requires_mtc', 'default_requires_supplier_batch', 'default_requires_serial_no',
  'default_moc', 'default_category_fields_json', 'default_requires_manufacturing',
];

function validate(b) {
  const name = String(b.item_name || '').trim();
  if (!name) return 'Item Name is required';
  if (!String(b.uom || '').trim()) return 'UOM is required';
  for (const f of NUMERIC_FIELDS) {
    const v = b[f];
    if (v !== undefined && v !== null && v !== '' && Number.isNaN(Number(v))) {
      return `${f.replace(/_/g, ' ')} must be a number`;
    }
  }
  if (b.bom_category && !(b.bom_category in CATEGORY_LABEL)) return 'Invalid BOM category';
  return null;
}

// Cheap in-process fuzzy match, same shape lib/tc-match.js's suggestBomItem already uses elsewhere
// in this app (fetch candidates, score by shared significant words) — 2,780 rows is small enough to
// scan directly, no need for a second SQL-side fuzzy mechanism.
async function findPossibleDuplicates(name) {
  const needle = normalizeWords(name);
  if (!needle.length) return [];
  const all = await queryAll('SELECT id, item_code, item_name FROM items', []);
  return all
    .map(r => ({ ...r, shared: normalizeWords(r.item_name).filter(w => needle.includes(w)).length }))
    .filter(r => r.shared >= 2)
    .sort((a, b) => b.shared - a.shared)
    .slice(0, 8);
}

export async function GET(req) {
  const user = await getFreshSessionUser();
  const denied = await requireEngineeringAction(user, 'engineering.item_master.write');
  if (denied) return denied;

  const sp = new URL(req.url).searchParams;
  const q = (sp.get('search') || '').trim();
  const page = Math.max(1, parseInt(sp.get('page') || '1', 10));
  const sort = SORTABLE.has(sp.get('sort')) ? sp.get('sort') : 'item_name';
  const dir = sp.get('dir') === 'desc' ? 'DESC' : 'ASC';

  let where = '';
  let args = [];
  if (q) {
    const needle = `%${q}%`;
    where = `WHERE ${SEARCH_FIELDS.map(f => `${f} LIKE ?`).join(' OR ')}`;
    args = SEARCH_FIELDS.map(() => needle);
  }

  const [{ n: total }, rows, uoms, categories, procTypes, itemTypes] = await Promise.all([
    queryOne(`SELECT COUNT(*) AS n FROM items ${where}`, args),
    queryAll(
      `SELECT id, item_code, item_name, category, bom_category, uom, material_process_type, item_type,
              group_name, main_group, sub_group, group_code, hsn_code, hsn_desc, hsn_item_pct,
              detail_desc, drg_no, drg_rev, part_no, cqty, cfactor, conv_uom, min_qty, max_qty,
              lead_time, tolerance_plus, tolerance_minus, class, store_location, bin_no,
              default_requires_heat_no, default_requires_mtc, default_requires_supplier_batch, default_requires_serial_no
         FROM items ${where}
        ORDER BY ${sort} ${dir}
        LIMIT ${PAGE_SIZE} OFFSET ${(page - 1) * PAGE_SIZE}`,
      args
    ),
    queryAll(`SELECT DISTINCT uom FROM items WHERE uom IS NOT NULL AND uom != '' ORDER BY uom`, []),
    queryAll(`SELECT DISTINCT category FROM items WHERE category IS NOT NULL AND category != '' ORDER BY category`, []),
    queryAll(`SELECT DISTINCT material_process_type FROM items WHERE material_process_type IS NOT NULL AND material_process_type != '' ORDER BY material_process_type`, []),
    queryAll(`SELECT DISTINCT item_type FROM items WHERE item_type IS NOT NULL AND item_type != '' ORDER BY item_type`, []),
  ]);

  return NextResponse.json({
    rows, total, page, pageSize: PAGE_SIZE,
    facets: {
      uom: uoms.map(r => r.uom),
      category: categories.map(r => r.category),
      material_process_type: procTypes.map(r => r.material_process_type),
      item_type: itemTypes.map(r => r.item_type),
      bom_category: Object.entries(CATEGORY_LABEL).map(([value, label]) => ({ value, label })),
    },
  });
}

export async function POST(req) {
  const user = await getFreshSessionUser();
  const denied = await requireEngineeringAction(user, 'engineering.item_master.write');
  if (denied) return denied;

  const b = await req.json();
  const err = validate(b);
  if (err) return NextResponse.json({ error: err }, { status: 400 });

  const name = b.item_name.trim();
  if (!b.confirm) {
    const duplicates = await findPossibleDuplicates(name);
    if (duplicates.length) {
      return NextResponse.json({ error: 'Possible duplicate Item Master records found', duplicates }, { status: 409 });
    }
  }

  const cols = EDITABLE_FIELDS.filter(f => f in b);
  cols.push('item_name'); // always present, already validated
  const uniqueCols = [...new Set(cols)];
  const { lastId } = await execute(
    `INSERT INTO items (${uniqueCols.join(', ')}) VALUES (${uniqueCols.map(() => '?').join(', ')})`,
    uniqueCols.map(f => (f === 'item_name' ? name : (b[f] === '' ? null : b[f] ?? null)))
  );
  const id = Number(lastId);
  const itemCode = `IM-${String(id).padStart(6, '0')}`;
  await execute('UPDATE items SET item_code = ? WHERE id = ?', [itemCode, id]);

  await audit('item_master_add', { actor: user.username, detail: JSON.stringify({ id, item_code: itemCode, item_name: name }) });
  return NextResponse.json({ id, item_code: itemCode }, { status: 201 });
}
