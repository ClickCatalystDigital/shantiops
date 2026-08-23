'use client';

// components/reports/ListReportCard.jsx — shared renderer for "a flat list of rows with one or two
// closing totals" reports (extracted from FixedAssetReportCards.jsx, which first built this shape
// to close an identical on-screen gap: a report can have a working compute()/toTable()/PDF export
// via lib/reports/catalog.js but no entry in ReportsWorkspace.jsx's SCREEN map, so selecting it in
// the browser shows "No report selected" — the PDF export is the only thing that actually worked).
import { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { api, showToast } from '@/lib/client';
import { fmt } from './TrialBalanceCard';

// columns: [{ label, key, render?, align? }] — render(row) overrides plain row[key] display.
export function ListReportCard({ company, endpoint, title, subtitle, columns, rowsKey, emptyLabel, totals }) {
  const [data, setData] = useState(null);
  useEffect(() => {
    api(`/api/reports/${endpoint}?company=${encodeURIComponent(company)}`).then(setData).catch(err => showToast(err.message, 'error'));
  }, [company, endpoint]);
  if (!data) return null;
  const rows = data[rowsKey] || [];
  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        {subtitle && <p className="text-xs text-muted-foreground">{subtitle(data)}</p>}
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-xs text-muted-foreground">
                {columns.map(c => <th key={c.key} className={`py-1 font-medium ${c.align === 'right' ? 'text-right' : 'text-left'}`}>{c.label}</th>)}
              </tr>
            </thead>
            <tbody className="divide-y">
              {rows.map((row, i) => (
                <tr key={i}>
                  {columns.map(c => (
                    <td key={c.key} className={`py-1.5 ${c.align === 'right' ? 'tnum text-right' : ''}`}>
                      {c.render ? c.render(row) : row[c.key]}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
          {!rows.length && <p className="py-2 text-sm text-muted-foreground">{emptyLabel}</p>}
        </div>
        {totals && (
          <div className="flex flex-wrap justify-end gap-x-6 gap-y-1 border-t pt-2 text-sm font-medium">
            {totals(data).map(([label, value]) => (
              <span key={label}>{label}: <span className="tnum">{fmt(value)}</span></span>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
