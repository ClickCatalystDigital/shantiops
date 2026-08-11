import { NextResponse } from 'next/server';
import { getSessionUser } from '@/lib/auth';
import { requireCalcAccess, getCalcState } from '@/lib/calc';
import { queryOne } from '@/lib/db';
import { computeAll, runValidations } from '@/lib/calc-engine';
import { renderCalcReportPdf } from '@/lib/calc-report-pdf';

export const runtime = 'nodejs';

export async function GET(req, { params }) {
  const user = getSessionUser();
  const denied = requireCalcAccess(user);
  if (denied) return denied;

  // Snapshots are sheet-scoped now (CALC-CHANGES2.md §A) — look the sheet up from the snapshot row
  // itself rather than requiring the caller to pass it, since a PDF link only carries the snapshot id.
  const snapshotRow = await queryOne('SELECT calc_sheet_id FROM calc_snapshots WHERE id = ?', [params.id]);
  if (!snapshotRow) return NextResponse.json({ error: 'Snapshot not found' }, { status: 404 });

  const { variables, formulas, validations, snapshots, tables } = await getCalcState(snapshotRow.calc_sheet_id);
  const snapshot = snapshots.find((s) => s.id === Number(params.id));
  if (!snapshot) return NextResponse.json({ error: 'Snapshot not found' }, { status: 404 });

  // Recompute the full trace pinned to this snapshot's exact formula versions/inputs — same
  // mechanism the Audit panel's "Reproduce" uses — so the report shows the full working, not just
  // the frozen final values.
  const { trace } = computeAll(variables, formulas, {
    formulaVersionOverride: snapshot.formulaVersionOverride, inputOverride: snapshot.inputOverride, tables,
  });
  const checks = runValidations(validations, snapshot.results);

  const pdf = await renderCalcReportPdf(snapshot, variables, formulas, trace, checks);
  return new NextResponse(pdf, {
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `inline; filename="calc-sheet-${snapshot.id}.pdf"`,
    },
  });
}
