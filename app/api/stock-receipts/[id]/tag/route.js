// app/api/stock-receipts/[id]/tag/route.js — the printable identification tag (Feature A). Default:
// every line that came in on this receipt. `?bom_item_id=` scopes it to one material line, for a
// single item out of a multi-line delivery — same shared header either way.
import { NextResponse } from 'next/server';
import { getFreshSessionUser, isInternal } from '@/lib/auth';
import { getReceipt, getReceiptLines, getReceiptCompany } from '@/lib/stock-receipts';
import { renderStockReceiptTagPdf } from '@/lib/stock-receipt-tag-pdf';

export async function GET(req, { params }) {
  const user = await getFreshSessionUser();
  if (!isInternal(user)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const receipt = await getReceipt(params.id);
  if (!receipt) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  // stock_receipts carries no company column of its own (gap found in review — every tag was
  // silently printing the Shanti Boilers letterhead regardless of the real entity).
  receipt.company = await getReceiptCompany(params.id);

  let lines = await getReceiptLines(params.id);
  const bomItemId = new URL(req.url).searchParams.get('bom_item_id');
  if (bomItemId) lines = lines.filter(l => l.kind === 'bom_item' && String(l.id) === bomItemId);

  const pdf = await renderStockReceiptTagPdf(receipt, lines);
  return new NextResponse(pdf, {
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `inline; filename="${receipt.inward_batch_no}-tag.pdf"`,
    },
  });
}
