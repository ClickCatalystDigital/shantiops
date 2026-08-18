'use client';

// components/ReportKit.jsx — shared building blocks for read-only report tabs (CrmReportsWorkspace
// first, ProcurementWorkspace's Vendor Analysis second). Charts follow the app's own existing bar
// idiom (BomProgress.jsx: thin rounded rows on bg-muted, semantic tokens) rather than a chart
// library — magnitude bars get one hue (chart-1), status rows get the reserved status tokens,
// never both on one row. "Download PDF" is the browser's native print-to-PDF against the scoped
// print stylesheet (app/globals.css, #report-print-area) — no charting/PDF dependency added.
import { Card, CardContent, CardHeader, CardTitle, CardAction } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { DownloadIcon } from 'lucide-react';

export function BarList({ items, valueFmt = String, colorFor = () => 'bg-chart-1' }) {
  const max = Math.max(1, ...items.map(i => i.value));
  if (items.length === 0) return <p className="text-sm text-muted-foreground">No data yet.</p>;
  return (
    <div className="flex flex-col gap-2">
      {items.map(i => (
        <div key={i.label} className="flex items-center gap-3 text-sm">
          <span className="w-32 shrink-0 truncate text-muted-foreground" title={i.label}>{i.label}</span>
          <div className="h-2 flex-1 overflow-hidden rounded-full bg-muted">
            <div className={`h-full rounded-full ${colorFor(i)}`} style={{ width: `${(i.value / max) * 100}%` }} />
          </div>
          <span className="w-20 shrink-0 text-right tnum text-xs text-muted-foreground">{valueFmt(i.value)}</span>
        </div>
      ))}
    </div>
  );
}

export function StatRow({ stats }) {
  return (
    <div className="flex flex-wrap gap-4 text-sm">
      {stats.map(s => (
        <div key={s.label}>
          <span className="text-muted-foreground">{s.label}: </span>
          <span className={`font-semibold tnum ${s.warn ? 'text-destructive' : ''}`}>{s.value}</span>
        </div>
      ))}
    </div>
  );
}

export function ReportShell({ title, description, action, children }) {
  return (
    <Card id="report-print-area">
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        <CardAction className="flex items-center gap-2">
          {action}
          <Button size="sm" variant="outline" onClick={() => window.print()}><DownloadIcon />Download PDF</Button>
        </CardAction>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {description && <p className="text-sm text-muted-foreground">{description}</p>}
        {children}
      </CardContent>
    </Card>
  );
}
