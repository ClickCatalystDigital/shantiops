// app/api/sales-products/route.js — Sales CRM expansion Phase 0b. The Product Master — a real,
// dedicated sellable-SKU catalog, deliberately its own small table, not folded into the
// raw-material Item Master (`items`) — same "own small catalog per line-shape, don't force-unify"
// precedent ItemSearchField vs QuotationItemField already set. GET (incl. ?search=) is CRM-wide
// (Sales OR Marketing) read; POST/PATCH are department-gated writes.
import { NextResponse } from 'next/server';
import { execute, queryAll, nextNumber } from '@/lib/db';
import { getFreshSessionUser, isInternal } from '@/lib/auth';
import { requireCrmAction } from '@/lib/action-permissions';
import { audit } from '@/lib/usb';

export async function GET(req) {
  const user = await getFreshSessionUser();
  if (!isInternal(user)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const q = (new URL(req.url).searchParams.get('search') || '').trim();
  if (q) {
    const needle = `%${q}%`;
    return NextResponse.json(await queryAll(
      `SELECT * FROM sales_products WHERE active = 1
         AND (product_name LIKE ? OR product_code LIKE ? OR product_type LIKE ?)
       ORDER BY product_name LIMIT 25`,
      [needle, needle, needle]
    ));
  }
  return NextResponse.json(await queryAll('SELECT * FROM sales_products ORDER BY product_name'));
}

export async function POST(req) {
  const user = await getFreshSessionUser();
  const denied = await requireCrmAction(user, 'sales.product.write');
  if (denied) return denied;

  const b = await req.json();
  const productName = String(b.product_name || '').trim();
  if (!productName) return NextResponse.json({ error: 'Product name is required' }, { status: 400 });

  // Auto-generate a code when left blank — same nextNumber() sequence idiom used for item_code/
  // gir_no/po_no elsewhere in this app. A manually-typed code (the client's own legacy code) is
  // stored verbatim instead.
  const productCode = String(b.product_code || '').trim() || await nextNumber('sales_product_code', 'PRD');

  try {
    const { lastId } = await execute(
      `INSERT INTO sales_products (product_code, product_name, product_type, description, price, unit, hsn_code, gst_pct, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [productCode, productName, b.product_type || null, b.description || null, b.price != null && b.price !== '' ? Number(b.price) : null,
        b.unit || null, b.hsn_code || null, b.gst_pct != null && b.gst_pct !== '' ? Number(b.gst_pct) : null, user.username]
    );
    await audit('sales_product_created', { actor: user.username, detail: `${productCode} — ${productName}` });
    return NextResponse.json({ id: Number(lastId), product_code: productCode });
  } catch (err) {
    if (String(err).toLowerCase().includes('unique')) {
      return NextResponse.json({ error: 'A product with that code already exists' }, { status: 409 });
    }
    throw err;
  }
}
