// Project page — Scope of Supply card: the order's details (client, references, product lines) with
// a PDF download. Server component: prices, totals and commercial terms are only rendered for
// viewers who see money (Sales/Marketing/PM), so nothing priced reaches anyone else's browser; the
// PDF route applies the same rule.
import { Card, CardHeader, CardTitle, CardAction, CardContent } from './ui/card';
import { Button } from './ui/button';
import { DownloadIcon, FileTextIcon } from 'lucide-react';
import { sosLine } from '@/lib/sos-format.mjs';
import { formatDate, formatMoney } from '@/lib/format';

function Fact({ label, value }) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className="text-sm font-medium">{value || '—'}</span>
    </div>
  );
}

function SosBlock({ sos, canSeeMoney, canOpenFile }) {
  const c = sos.customer || {};
  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-3">
        <span className="text-sm font-semibold">{sos.title}</span>
        <div className="flex gap-2">
          {canOpenFile && sos.pdf_key && (
            <Button asChild size="sm" variant="outline">
              <a href={`/api/scope-of-supply/${sos.id}/file`} target="_blank" rel="noreferrer"><FileTextIcon data-icon="inline-start" />Original file</a>
            </Button>
          )}
          <Button asChild size="sm" variant="outline">
            <a href={`/api/scope-of-supply/${sos.id}/pdf`} target="_blank" rel="noreferrer"><DownloadIcon data-icon="inline-start" />Generated PDF</a>
          </Button>
        </div>
      </div>
      <div className="grid gap-4 rounded-lg border bg-muted/30 p-4 sm:grid-cols-2 lg:grid-cols-4">
        <Fact label="Client" value={c.name || sos.customer_name} />
        <Fact label="GSTIN" value={c.gst_no} />
        <Fact label="Job No" value={sos.jobNo} />
        <Fact label="Order No" value={sos.soNo} />
        <Fact label="Offer" value={[sos.offerNo, sos.offerDate && formatDate(sos.offerDate)].filter(Boolean).join(' · ')} />
        <Fact label="PO No / Date" value={[sos.po_no, sos.po_date && formatDate(sos.po_date)].filter(Boolean).join(' · ')} />
        <Fact label="Contact" value={[c.phone, c.email].filter(Boolean).join(' · ')} />
        <Fact label="Scope of Supply date" value={formatDate(sos.created_at)} />
      </div>

      {sos.items.length === 0 ? (
        <p className="text-sm text-muted-foreground">No product lines yet.</p>
      ) : (
        <ol className="flex flex-col divide-y rounded-lg border">
          {sos.items.map((it, i) => {
            const l = sosLine(it);
            const qty = [it.qty, it.uom].filter(v => v != null && v !== '').join(' ');
            return (
              <li key={it.id} className="flex gap-3 px-4 py-3">
                <span className="w-5 shrink-0 text-sm text-muted-foreground">{i + 1}</span>
                <div className="flex min-w-0 flex-1 flex-col gap-1">
                  <span className="text-sm font-semibold">{l.name}</span>
                  {(l.type || l.hsn) && (
                    <span className="text-[11px] uppercase tracking-wide text-muted-foreground">{[l.type, l.hsn && `HSN ${l.hsn}`].filter(Boolean).join('  ·  ')}</span>
                  )}
                  {l.body && <p className="text-sm leading-snug text-foreground/90">{l.body}</p>}
                  {l.exclusions && <p className="text-xs text-muted-foreground"><span className="font-semibold">Exclusions:</span> {l.exclusions}</p>}
                </div>
                <div className="shrink-0 text-right text-sm">
                  <div className="font-medium">{qty || '—'}</div>
                  {canSeeMoney && <div className="text-xs text-muted-foreground">{it.amount != null ? formatMoney(it.amount) : '—'}</div>}
                </div>
              </li>
            );
          })}
        </ol>
      )}

      {canSeeMoney && (
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="grid grid-cols-2 gap-3 text-sm">
            <Fact label="Payment" value={sos.payment_terms} />
            <Fact label="Freight" value={sos.freight_terms} />
            <Fact label="Delivery" value={sos.delivery_terms} />
            <Fact label="Prepared by" value={sos.prepared_by} />
          </div>
          <div className="ml-auto flex w-full max-w-xs flex-col gap-1 text-sm">
            <div className="flex justify-between"><span className="text-muted-foreground">Total</span><span>{formatMoney(sos.basicTotal)}</span></div>
            <div className="flex justify-between"><span className="text-muted-foreground">GST @ {sos.tax_pct}%</span><span>{formatMoney(sos.taxAmount)}</span></div>
            <div className="flex justify-between border-t pt-1 font-semibold"><span>Total value</span><span>{formatMoney(sos.grandTotal)}</span></div>
          </div>
        </div>
      )}
    </div>
  );
}

export default function ScopeOfSupplyCard({ scopeOfSupply = [], canSeeMoney = false, canOpenFile = false }) {
  return (
    <Card>
      <CardHeader><CardTitle>Scope of Supply</CardTitle></CardHeader>
      <CardContent className="flex flex-col gap-6">
        {scopeOfSupply.length === 0
          ? <p className="text-sm text-muted-foreground">No Scope of Supply yet — attach it from Edit Project.</p>
          : scopeOfSupply.map(sos => <SosBlock key={sos.id} sos={sos} canSeeMoney={canSeeMoney} canOpenFile={canOpenFile} />)}
      </CardContent>
    </Card>
  );
}
