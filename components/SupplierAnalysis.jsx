'use client';

// components/SupplierAnalysis.jsx — the Analysis half of Procurement's Suppliers tab (SYSTEM.md
// §5c; the other half, the roster, stays in ProcurementWorkspace.jsx's existing `Suppliers`
// component). Named "Suppliers" everywhere in the UI, never "Vendor" — the app already has one
// word for this entity and mixing in a second one is exactly the kind of thing that makes a user
// wonder if they're two different things. Read-only, derived entirely from data Procurement
// already logs (supplier_quotes, purchase_orders/po_items) — no new table, no schema change.
//
// Deliberately does NOT compute an on-time-delivery % or a composite supplier "rating":
// bom_items.received_ref is free text (a person typed "12 recv 4/8"), not a structured date, so
// there is no honest way to compare it against supplier_quotes.expected_delivery_date yet. That
// needs received_ref split into real columns first — a real follow-up, not something to fake with
// what's here today.
import { useState, useMemo, Fragment } from 'react';
import { ReportShell, StatRow, BarList } from '@/components/ReportKit';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { DownloadIcon } from 'lucide-react';
import { formatMoney, formatDate } from '@/lib/format';

function bySupplierStats(suppliers, quotes, purchaseOrders) {
  return suppliers.map(s => {
    const sQuotes = quotes.filter(q => q.supplier_id === s.id).sort((a, b) => new Date(b.quoted_at) - new Date(a.quoted_at));
    const won = sQuotes.filter(q => q.is_selected).length;
    const sPOs = purchaseOrders.filter(po => po.supplier_id === s.id && po.status === 'issued');
    const spend = sPOs.reduce((sum, po) => sum + (po.subtotal || 0), 0);
    return {
      supplier: s, quotes: sQuotes,
      quoteCount: sQuotes.length, won,
      winRate: sQuotes.length ? Math.round((won / sQuotes.length) * 100) : null,
      poCount: sPOs.length, spend,
    };
  });
}

const MONTH_FMT = d => d.toLocaleDateString('en-US', { month: 'short', year: '2-digit' });

function SupplierDashboard({ suppliers, quotes, purchaseOrders }) {
  const rows = useMemo(() => bySupplierStats(suppliers, quotes, purchaseOrders), [suppliers, quotes, purchaseOrders]);
  const totalSpend = rows.reduce((s, r) => s + r.spend, 0);
  const totalQuotes = quotes.length;
  const totalWon = quotes.filter(q => q.is_selected).length;
  const overallWinRate = totalQuotes ? Math.round((totalWon / totalQuotes) * 100) : null;
  const activeCount = rows.filter(r => r.quoteCount > 0 || r.poCount > 0).length;

  const topSpend = useMemo(() => [...rows].filter(r => r.spend > 0).sort((a, b) => b.spend - a.spend).slice(0, 6)
    .map(r => ({ label: r.supplier.name, value: r.spend })), [rows]);

  const topWinRate = useMemo(() => rows.filter(r => r.quoteCount >= 2).sort((a, b) => b.winRate - a.winRate).slice(0, 6)
    .map(r => ({ label: r.supplier.name, value: r.winRate })), [rows]);

  const itemCounts = useMemo(() => {
    const byDesc = {};
    for (const q of quotes) byDesc[q.material_description] = (byDesc[q.material_description] || 0) + 1;
    return Object.entries(byDesc).sort((a, b) => b[1] - a[1]).slice(0, 6).map(([label, value]) => ({ label, value }));
  }, [quotes]);

  const spendByMonth = useMemo(() => {
    const now = new Date();
    const months = Array.from({ length: 6 }, (_, i) => {
      const d = new Date(now.getFullYear(), now.getMonth() - (5 - i), 1);
      return { key: `${d.getFullYear()}-${d.getMonth()}`, label: MONTH_FMT(d), value: 0 };
    });
    const byKey = Object.fromEntries(months.map(m => [m.key, m]));
    for (const po of purchaseOrders) {
      if (po.status !== 'issued' || !po.issued_at) continue;
      const d = new Date(po.issued_at);
      const bucket = byKey[`${d.getFullYear()}-${d.getMonth()}`];
      if (bucket) bucket.value += po.subtotal || 0;
    }
    return months;
  }, [purchaseOrders]);

  const recentQuotes = useMemo(() => [...quotes].sort((a, b) => new Date(b.quoted_at) - new Date(a.quoted_at)).slice(0, 8), [quotes]);

  const kpis = [
    { label: 'Suppliers with activity', value: activeCount },
    { label: 'Quotes logged', value: totalQuotes },
    { label: 'Total PO spend', value: formatMoney(totalSpend) },
    { label: 'Overall win rate', value: overallWinRate == null ? '—' : `${overallWinRate}%`, tone: overallWinRate >= 50 ? 'text-success' : overallWinRate != null ? 'text-warning' : '' },
  ];
  const hasSpendTrend = spendByMonth.some(m => m.value > 0);

  return (
    // Same print scoping ReportShell's Card carries (#report-print-area, app/globals.css) — this
    // is a multi-Card layout instead of one Card, so the id moves to the wrapping div.
    <div id="report-print-area" className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold">Dashboard</h2>
          <p className="text-sm text-muted-foreground">A portfolio view across every supplier — spend, quote activity, and win rate at a glance.</p>
        </div>
        <Button size="sm" variant="outline" className="print:hidden" onClick={() => window.print()}><DownloadIcon />Download PDF</Button>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {kpis.map(k => (
          <Card key={k.label}>
            <CardContent className="py-4">
              <div className={`text-2xl font-bold tnum ${k.tone || ''}`}>{k.value}</div>
              <div className="text-xs text-muted-foreground">{k.label}</div>
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-sm">Issued-PO spend, last 6 months</CardTitle>
            <CardDescription>Where the real committed spend has been trending.</CardDescription>
          </CardHeader>
          <CardContent>
            {hasSpendTrend ? <BarList items={spendByMonth} valueFmt={formatMoney} /> : <p className="text-sm text-muted-foreground">No issued POs yet.</p>}
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="text-sm">Top suppliers by spend</CardTitle>
            <CardDescription>Who the issued-PO money has actually gone to.</CardDescription>
          </CardHeader>
          <CardContent>
            {topSpend.length > 0 ? <BarList items={topSpend} valueFmt={formatMoney} /> : <p className="text-sm text-muted-foreground">No issued POs yet.</p>}
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="text-sm">Top win rate (2+ quotes)</CardTitle>
            <CardDescription>Suppliers who convert quotes into the actual pick, not just volume.</CardDescription>
          </CardHeader>
          <CardContent>
            {topWinRate.length > 0 ? <BarList items={topWinRate} valueFmt={v => `${v}%`} colorFor={() => 'bg-success'} /> : <p className="text-sm text-muted-foreground">Not enough repeat quoting yet — needs 2+ quotes from the same supplier.</p>}
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="text-sm">Most-quoted items</CardTitle>
            <CardDescription>What Procurement is sourcing quotes for most often.</CardDescription>
          </CardHeader>
          <CardContent>
            {itemCounts.length > 0 ? <BarList items={itemCounts} /> : <p className="text-sm text-muted-foreground">No quotes logged yet.</p>}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-sm">Recent quotes</CardTitle>
          <CardDescription>The last 8 quotes logged, most recent first — a raw feed underneath the rollups above.</CardDescription>
        </CardHeader>
        <CardContent>
          {recentQuotes.length === 0 ? <p className="text-sm text-muted-foreground">No quotes logged yet.</p> : (
            <Table>
              <TableHeader>
                <TableRow><TableHead>Supplier</TableHead><TableHead>Item</TableHead><TableHead>Price</TableHead><TableHead>Date</TableHead></TableRow>
              </TableHeader>
              <TableBody>
                {recentQuotes.map(q => (
                  <TableRow key={q.id}>
                    <TableCell className="font-medium">{q.supplier_name}{q.is_selected ? <Badge variant="outline" className="ml-1.5">Won</Badge> : null}</TableCell>
                    <TableCell className="max-w-48 truncate">{q.material_description}</TableCell>
                    <TableCell className="tnum">{formatMoney(q.unit_price)}</TableCell>
                    <TableCell>{formatDate(q.quoted_at)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function BySupplier({ suppliers, quotes, purchaseOrders, q: search }) {
  const [expanded, setExpanded] = useState(null);
  const needle = search.trim().toLowerCase();
  const rows = useMemo(() => bySupplierStats(suppliers, quotes, purchaseOrders), [suppliers, quotes, purchaseOrders]);
  const shown = rows.filter(r => !needle || r.supplier.name.toLowerCase().includes(needle))
    .sort((a, b) => b.spend - a.spend || b.quoteCount - a.quoteCount);
  const totalSpend = rows.reduce((s, r) => s + r.spend, 0);
  const avgQuotes = rows.length ? Math.round((rows.reduce((s, r) => s + r.quoteCount, 0) / rows.length) * 10) / 10 : 0;
  const topSpend = [...rows].filter(r => r.spend > 0).sort((a, b) => b.spend - a.spend).slice(0, 8)
    .map(r => ({ label: r.supplier.name, value: r.spend }));

  return (
    <ReportShell title="By Supplier"
      description="Spend, quote activity, and win rate per supplier — derived from logged quotes and issued purchase orders. Click a supplier to see their full quote history.">
      <StatRow stats={[
        { label: 'Suppliers', value: rows.length },
        { label: 'Total PO spend', value: formatMoney(totalSpend) },
        { label: 'Avg quotes / supplier', value: avgQuotes },
      ]} />
      {topSpend.length > 0 && (
        <div>
          <h3 className="mb-2 text-xs font-medium text-muted-foreground">Top suppliers by spend</h3>
          <BarList items={topSpend} valueFmt={formatMoney} />
        </div>
      )}
      {shown.length === 0 ? <p className="text-sm text-muted-foreground">No suppliers match.</p> : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Supplier</TableHead><TableHead>Quotes</TableHead><TableHead>Won</TableHead>
              <TableHead>Win rate</TableHead><TableHead>POs</TableHead><TableHead>Spend</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {shown.map(r => (
              <Fragment key={r.supplier.id}>
                <TableRow className="cursor-pointer" onClick={() => setExpanded(expanded === r.supplier.id ? null : r.supplier.id)}>
                  <TableCell className="font-medium">{r.supplier.name}</TableCell>
                  <TableCell className="tnum">{r.quoteCount}</TableCell>
                  <TableCell className="tnum">{r.won}</TableCell>
                  <TableCell className="tnum">{r.winRate == null ? '—' : `${r.winRate}%`}</TableCell>
                  <TableCell className="tnum">{r.poCount}</TableCell>
                  <TableCell className="tnum">{formatMoney(r.spend)}</TableCell>
                </TableRow>
                {expanded === r.supplier.id && (
                  <TableRow>
                    <TableCell colSpan={6} className="bg-muted/30">
                      {r.quotes.length === 0 ? <p className="py-2 text-xs text-muted-foreground">No quotes logged yet.</p> : (
                        <div className="flex flex-col gap-1.5 py-2 text-xs">
                          {r.quotes.map(q => (
                            <div key={q.id} className="flex items-center justify-between gap-2">
                              <span className="truncate">
                                {q.material_description} <span className="text-muted-foreground">· {q.project_no}</span>
                                {q.is_selected ? <Badge variant="outline" className="ml-1.5">Won</Badge> : null}
                              </span>
                              <span className="shrink-0 text-muted-foreground">{formatMoney(q.unit_price)} · {formatDate(q.quoted_at)}</span>
                            </div>
                          ))}
                        </div>
                      )}
                    </TableCell>
                  </TableRow>
                )}
              </Fragment>
            ))}
          </TableBody>
        </Table>
      )}
    </ReportShell>
  );
}

// Small inline-SVG trend line, same idiom as CalcWorkspace's sensitivity-sweep chart — no chart
// dependency. Only rendered once there's enough real history to say anything (>= 3 quotes).
function PriceTrend({ quotes }) {
  const points = [...quotes].sort((a, b) => new Date(a.quoted_at) - new Date(b.quoted_at));
  if (points.length < 3) return null;
  const w = 320, h = 64, pad = 6;
  const ys = points.map(p => p.unit_price);
  const minY = Math.min(...ys), maxY = Math.max(...ys);
  const range = maxY - minY || 1;
  const stepX = (w - pad * 2) / (points.length - 1);
  const path = points.map((p, i) => {
    const x = pad + i * stepX;
    const y = h - pad - ((p.unit_price - minY) / range) * (h - pad * 2);
    return `${i === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(' ');
  return (
    <div>
      <h3 className="mb-2 text-xs font-medium text-muted-foreground">Price trend ({formatMoney(minY)} – {formatMoney(maxY)})</h3>
      <svg viewBox={`0 0 ${w} ${h}`} className="w-full max-w-sm text-chart-1">
        <path d={path} fill="none" stroke="currentColor" strokeWidth="1.5" />
      </svg>
    </div>
  );
}

function ByItem({ quotes, q: search }) {
  const needle = search.trim().toLowerCase();
  const items = useMemo(() => {
    const byDesc = {};
    for (const quote of quotes) (byDesc[quote.material_description] ||= []).push(quote);
    return Object.entries(byDesc)
      .map(([desc, qs]) => ({ desc, quotes: qs.sort((a, b) => new Date(b.quoted_at) - new Date(a.quoted_at)) }))
      .sort((a, b) => b.quotes.length - a.quotes.length);
  }, [quotes]);
  const shown = items.filter(i => !needle || i.desc.toLowerCase().includes(needle));
  const [selectedDesc, setSelectedDesc] = useState(null);
  const active = items.find(i => i.desc === selectedDesc) || shown[0];

  const supplierCount = active ? new Set(active.quotes.map(q => q.supplier_id)).size : 0;
  const cheapest = active ? Math.min(...active.quotes.map(q => q.unit_price)) : null;
  const latest = active?.quotes[0];

  return (
    <ReportShell title="By Item (Purchase Card)"
      description="Every logged quote for one material, across every supplier and project — a price history to check before negotiating.">
      {shown.length === 0 ? (
        <p className="text-sm text-muted-foreground">No quotes logged yet.</p>
      ) : (
        <div className="flex flex-col gap-4">
          <div className="flex flex-wrap gap-1.5">
            {shown.slice(0, 30).map(i => (
              <button key={i.desc} type="button" onClick={() => setSelectedDesc(i.desc)}
                className={`rounded-full border px-2.5 py-1 text-xs transition-colors ${active?.desc === i.desc ? 'border-primary bg-primary/10 text-primary' : 'text-muted-foreground hover:bg-muted/50'}`}>
                {i.desc} <span className="tnum">({i.quotes.length})</span>
              </button>
            ))}
          </div>
          {active && (
            <div className="flex flex-col gap-4 border-t pt-4">
              <StatRow stats={[
                { label: 'Suppliers quoted', value: supplierCount },
                { label: 'Cheapest logged', value: cheapest == null ? '—' : formatMoney(cheapest) },
                { label: 'Most recent', value: latest ? `${formatMoney(latest.unit_price)} (${latest.supplier_name})` : '—' },
              ]} />
              <PriceTrend quotes={active.quotes} />
              <Table>
                <TableHeader>
                  <TableRow><TableHead>Supplier</TableHead><TableHead>Project</TableHead><TableHead>Price</TableHead><TableHead>Date</TableHead></TableRow>
                </TableHeader>
                <TableBody>
                  {active.quotes.map(q => (
                    <TableRow key={q.id}>
                      <TableCell className="font-medium">{q.supplier_name}{q.is_selected ? <Badge variant="outline" className="ml-1.5">Won</Badge> : null}</TableCell>
                      <TableCell>{q.project_no}</TableCell>
                      <TableCell className="tnum">{formatMoney(q.unit_price)}</TableCell>
                      <TableCell>{formatDate(q.quoted_at)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </div>
      )}
    </ReportShell>
  );
}

export default function SupplierAnalysis({ view, suppliers, quotes, purchaseOrders, q }) {
  if (view === 'item') return <ByItem quotes={quotes} q={q} />;
  if (view === 'supplier') return <BySupplier suppliers={suppliers} quotes={quotes} purchaseOrders={purchaseOrders} q={q} />;
  return <SupplierDashboard suppliers={suppliers} quotes={quotes} purchaseOrders={purchaseOrders} />;
}
