// app/api/packing/[id]/freight/route.js — Dispatch accounting integration, 2026-08-23. A separate,
// explicit action (not a side effect of the generic PATCH) so the ordering lesson from the RCM real
// transaction test (SYSTEM.md §5ai) can't recur here: a state-changing update racing ahead of
// postJournalEntry(). Nothing is written to packing_lists by this route at all — it only reads the
// already-saved freight_amount (single source of truth for what's displayed vs. what's posted) and
// posts. postJournalEntry() is itself idempotent (checks for an existing entry by
// source_type/source_id before inserting), so a repeated call safely no-ops.
import { NextResponse } from 'next/server';
import { queryOne } from '@/lib/db';
import { getFreshSessionUser, requireDepartment } from '@/lib/auth';
import { requireAction } from '@/lib/action-permissions';
import { postJournalEntry } from '@/lib/ledger-post';
import { dispatchFreightLines } from '@/lib/ledger.mjs';
import { todayISO } from '@/lib/date';

export async function POST(req, { params }) {
  const user = await getFreshSessionUser();
  const denied = requireDepartment(user, 'Dispatch');
  if (denied) return denied;
  const actionDenied = await requireAction(user, 'Dispatch', 'dispatch.packing.freight');
  if (actionDenied) return actionDenied;

  const list = await queryOne(
    `SELECT pl.id, pl.packing_no, pl.freight_amount, pl.freight_paid_by, p.company
       FROM packing_lists pl LEFT JOIN projects p ON p.id = pl.project_id WHERE pl.id = ?`,
    [params.id]
  );
  if (!list) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  if (!list.company) return NextResponse.json({ error: 'This packing list has no project/company linked — cannot post to the ledger.' }, { status: 400 });
  if (!list.freight_amount) return NextResponse.json({ error: 'No freight amount set on this packing list.' }, { status: 400 });
  if (list.freight_paid_by !== 'us') {
    return NextResponse.json({ error: 'Freight is only posted to the ledger when the company bears the cost.' }, { status: 400 });
  }

  const entry = await postJournalEntry({
    company: list.company,
    entryDate: todayISO(),
    sourceType: 'dispatch_freight',
    sourceId: list.id,
    description: `Freight — Packing List ${list.packing_no}`,
    lines: dispatchFreightLines({ amount: list.freight_amount }),
    createdBy: user.username,
  });
  return NextResponse.json({ ok: true, journalEntryId: entry });
}
