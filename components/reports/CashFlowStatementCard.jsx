'use client';

// components/reports/CashFlowStatementCard.jsx — ACCOUNTING-IMPLEMENTATION-PLAN.md Phase 9. Same
// gap-closing motivation as FixedAssetReportCards.jsx (SYSTEM.md §5ac) — a working compute()/
// toTable()/PDF export existed but no ReportsWorkspace.jsx SCREEN entry. Three named sections
// (Operating/Investing/Financing), same "multiple labelled groups of rows" shape ProfitLossCard
// already uses for Income/Expense, just with {label, amount} presentation rows instead of ledger
// account rows (a cash flow statement's line items — Net Profit, Add: Depreciation, ... — are a
// presentation structure, not raw account rows, same reasoning lib/reports/render.js's
// cashFlowTable() already used for the PDF).
import { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { api, showToast } from '@/lib/client';
import { fmt } from './TrialBalanceCard';

function Row({ label, amount }) {
  return (
    <div className="flex justify-between gap-2 py-1 text-sm">
      <span className="truncate">{label}</span>
      <span className="tnum shrink-0">{fmt(amount)}</span>
    </div>
  );
}

export default function CashFlowStatementCard({ company }) {
  const [data, setData] = useState(null);
  useEffect(() => {
    api(`/api/reports/cash-flow?company=${encodeURIComponent(company)}`).then(setData).catch(err => showToast(err.message, 'error'));
  }, [company]);
  if (!data) return null;
  const { operating, investing, financing } = data;
  return (
    <Card>
      <CardHeader><CardTitle>Cash Flow Statement</CardTitle></CardHeader>
      <CardContent className="flex flex-col gap-4">
        <div>
          <p className="mb-1 text-xs font-medium text-muted-foreground">Operating Activities</p>
          <div className="flex flex-col divide-y">
            <Row label="Net Profit" amount={operating.netProfit} />
            <Row label="Add: Depreciation" amount={operating.depreciationAddback} />
            <Row label="Add/Less: Reversal of (Gain)/Loss on Asset Disposal" amount={operating.disposalReversal} />
            {operating.workingCapital.map(w => <Row key={w.account_code} label={`Change in ${w.account_name}`} amount={w.change} />)}
          </div>
          <div className="flex justify-between border-t pt-1 text-sm font-medium">
            <span>Net Cash from Operating Activities</span><span className="tnum">{fmt(operating.netOperating)}</span>
          </div>
        </div>
        <div>
          <p className="mb-1 text-xs font-medium text-muted-foreground">Investing Activities</p>
          <div className="flex flex-col divide-y">
            {investing.lines.map((l, i) => <Row key={i} label={l.description || l.source_type} amount={(l.debit || 0) - (l.credit || 0)} />)}
            {!investing.lines.length && <p className="py-1 text-sm text-muted-foreground">No investing activity this period.</p>}
          </div>
          <div className="flex justify-between border-t pt-1 text-sm font-medium">
            <span>Net Cash from Investing Activities</span><span className="tnum">{fmt(investing.netInvesting)}</span>
          </div>
        </div>
        <div>
          <p className="mb-1 text-xs font-medium text-muted-foreground">Financing Activities</p>
          <div className="flex flex-col divide-y">
            {financing.lines.map(f => <Row key={f.account_code} label={`Change in ${f.account_name}`} amount={f.change} />)}
            {!financing.lines.length && <p className="py-1 text-sm text-muted-foreground">No financing activity this period.</p>}
          </div>
          <div className="flex justify-between border-t pt-1 text-sm font-medium">
            <span>Net Cash from Financing Activities</span><span className="tnum">{fmt(financing.netFinancing)}</span>
          </div>
        </div>
        <div className="flex justify-between border-t pt-2 text-base font-semibold">
          <span>Net Change in Cash</span><span className="tnum">{fmt(data.netChangeInCash)}</span>
        </div>
      </CardContent>
    </Card>
  );
}
