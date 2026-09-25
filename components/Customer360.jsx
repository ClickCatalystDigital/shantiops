'use client';

// components/Customer360.jsx — Sales CRM plan 4. Shown in the Sales customer sheet: one view of a
// customer's enquiries, Diary, quotations, orders, payments, projects, invoices, service, installed
// base (with warranty) and competitors, from GET /api/customers/[id]/overview. "Open in Reports"
// links open a Sales report pre-filtered to this customer (?customer=).
import { useEffect, useState } from 'react';
import { api, showToast } from '@/lib/client';
import { formatMoney, formatDate } from '@/lib/format';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { TrashIcon } from 'lucide-react';

const WARRANTY = {
  active: w => `Warranty to ${formatDate(w.end)} (${w.daysLeft} days left)`,
  expired: w => `Warranty ended ${formatDate(w.end)}`,
  not_started: w => `${w.days}-day warranty starts at ${w.basis}`,
  none: () => 'No warranty recorded',
};

function Section({ title, count, report, customerId, children }) {
  return (
    <div>
      <div className="mb-1.5 flex items-center justify-between gap-2">
        <div className="text-sm font-semibold">{title}{count != null ? <span className="ml-1 font-normal text-muted-foreground">({count})</span> : null}</div>
        {report && <a className="text-xs text-primary hover:underline" href={`/reports?dept=Sales&report=${report}&customer=${customerId}`}>Open in Reports</a>}
      </div>
      {children}
    </div>
  );
}

function Rows({ items, empty, render }) {
  if (!items.length) return <p className="text-xs text-muted-foreground">{empty}</p>;
  return <div className="flex flex-col gap-1">{items.slice(0, 8).map(render)}{items.length > 8 && <p className="text-xs text-muted-foreground">+{items.length - 8} more</p>}</div>;
}

const Row = ({ children }) => <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-0.5 rounded border px-2 py-1.5 text-sm">{children}</div>;

export default function Customer360({ customerId }) {
  const [d, setD] = useState(null);
  const [comp, setComp] = useState({ competitor: '', product: '', price: '' });
  const load = () => api(`/api/customers/${customerId}/overview`).then(setD).catch(err => showToast(err.message, 'error'));
  useEffect(() => { load(); }, [customerId]); // eslint-disable-line react-hooks/exhaustive-deps

  async function addCompetitor() {
    if (!comp.competitor.trim()) return;
    try {
      await api('/api/competitors', { method: 'POST', body: { customer_id: customerId, ...comp } });
      setComp({ competitor: '', product: '', price: '' });
      load();
    } catch (err) { showToast(err.message, 'error'); }
  }
  async function removeCompetitor(c) {
    try { await api(`/api/competitors/${c.id}`, { method: 'DELETE' }); load(); } catch (err) { showToast(err.message, 'error'); }
  }

  if (!d) return <p className="text-sm text-muted-foreground">Loading the customer overview…</p>;
  const orderValue = d.orders.filter(o => o.status !== 'cancelled').reduce((s, o) => s + (o.total || 0), 0);
  const received = d.orders.reduce((s, o) => s + (o.received || 0), 0);
  const openEnq = d.enquiries.filter(l => !['Order Received', 'Order Lost'].includes(l.sales_call_status)).length;
  const openCalls = d.serviceCalls.filter(c => !['resolved', 'closed'].includes(c.status)).length;

  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {[['Open enquiries', openEnq], ['Orders', `${d.orders.length} · ${formatMoney(orderValue)}`], ['Received', formatMoney(received)], ['Outstanding', formatMoney(Math.max(0, orderValue - received))],
          ['Quotations', d.quotations.length], ['Projects', d.projects.length], ['Open service calls', openCalls], ['Competitors', d.competitors.length]].map(([l, v]) => (
          <div key={l} className="rounded-lg border p-2"><div className="text-xs text-muted-foreground">{l}</div><div className="text-sm font-semibold tnum">{v}</div></div>
        ))}
      </div>

      <Section title="Enquiries" count={d.enquiries.length} report="sales_call_funnel" customerId={customerId}>
        <Rows items={d.enquiries} empty="No enquiries linked to this customer." render={l => (
          <Row key={l.id}><a className="text-primary hover:underline" href={`/sales?tab=leads&highlight=LD-${l.id}`}>LD-{l.id} {l.company_name || l.lead_name}</a>
            <span className="text-xs text-muted-foreground">{l.sales_call_status}{l.expected_value ? ` · ${formatMoney(l.expected_value)}` : ''}</span></Row>
        )} />
      </Section>

      <Section title="Quotations" count={d.quotations.length} report="quotation_listing" customerId={customerId}>
        <Rows items={d.quotations} empty="No quotations." render={q => (
          <Row key={q.id}><a className="text-primary hover:underline" href={`/api/quotations/${q.id}/pdf`} target="_blank" rel="noreferrer">{q.quotation_no}</a>
            <span className="text-xs text-muted-foreground">{q.status}{q.approval_status === 'pending' ? ' · needs approval' : ''} · {formatMoney(q.total)}</span></Row>
        )} />
      </Section>

      <Section title="Orders & payments" count={d.orders.length}>
        <Rows items={d.orders} empty="No orders." render={o => (
          <Row key={o.id}><span>{o.so_no}{o.order_date ? ` · ${formatDate(o.order_date)}` : ''}</span>
            <span className="text-xs text-muted-foreground tnum">{formatMoney(o.total)} · received {formatMoney(o.received) || '₹0'}{o.status === 'cancelled' ? ' · cancelled' : ''}</span></Row>
        )} />
      </Section>

      <Section title="Invoices" count={d.invoices.length}>
        <Rows items={d.invoices} empty="No invoices." render={i => (
          <Row key={i.id}><a className="text-primary hover:underline" href={`/api/sales-invoices/${i.id}/pdf`} target="_blank" rel="noreferrer">{i.invoice_no}</a>
            <span className="text-xs text-muted-foreground tnum">{i.status} · {formatMoney(i.total)} · received {formatMoney(i.received) || '₹0'}</span></Row>
        )} />
      </Section>

      <Section title="Projects" count={d.projects.length}>
        <Rows items={d.projects} empty="No projects." render={p => (
          <Row key={p.id}><a className="text-primary hover:underline" href={`/projects/${p.id}`}>{p.project_no}</a><span className="text-xs text-muted-foreground">{p.name} · {p.status}</span></Row>
        )} />
      </Section>

      <Section title="Installed base" count={d.installedBase.length}>
        <Rows items={d.installedBase} empty="Nothing ordered yet." render={it => (
          <Row key={it.id}><span>{it.item_description}{it.qty ? ` × ${it.qty}` : ''}<span className="ml-1 text-xs text-muted-foreground">{[it.so_no, it.project_no].filter(Boolean).join(' · ')}</span></span>
            <span className="flex flex-wrap items-center gap-1 text-xs text-muted-foreground">
              <Badge variant={it.warranty.status === 'active' ? 'default' : 'outline'}>{WARRANTY[it.warranty.status](it.warranty)}</Badge>
              {it.preventive_maintenance && <span>PM: {it.preventive_maintenance}</span>}
            </span></Row>
        )} />
      </Section>

      <Section title="Service" count={d.serviceCalls.length + d.serviceContracts.length}>
        <Rows items={[...d.serviceContracts.map(c => ({ ...c, kind: 'contract' })), ...d.serviceCalls.map(c => ({ ...c, kind: 'call' }))]} empty="No service calls or contracts." render={s => (
          <Row key={`${s.kind}-${s.id}`}>{s.kind === 'contract'
            ? <><span>{s.contract_no} (contract)</span><span className="text-xs text-muted-foreground">{s.status} · {formatDate(s.start_date)} – {formatDate(s.end_date)}</span></>
            : <><span>{s.call_no} {s.subject}</span><span className="text-xs text-muted-foreground">{s.status} · {s.priority}</span></>}</Row>
        )} />
      </Section>

      <Section title="Competitors" count={d.competitors.length} report="competitor_analysis" customerId={customerId}>
        <Rows items={d.competitors} empty="No competitors recorded." render={c => (
          <Row key={c.id}><span>{c.competitor}{c.lost_to ? <Badge variant="destructive" className="ml-1.5">Lost to</Badge> : null}</span>
            <span className="flex items-center gap-2 text-xs text-muted-foreground">{[c.product, c.price != null ? formatMoney(c.price) : null, c.lead_id ? `LD-${c.lead_id}` : null].filter(Boolean).join(' · ')}
              <Button size="icon-sm" variant="ghost" onClick={() => removeCompetitor(c)} aria-label="Remove"><TrashIcon className="size-3.5" /></Button></span></Row>
        )} />
        <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-[1fr_1fr_7rem_auto]">
          <Input placeholder="Competitor" value={comp.competitor} onChange={e => setComp(c => ({ ...c, competitor: e.target.value }))} />
          <Input placeholder="Their product" value={comp.product} onChange={e => setComp(c => ({ ...c, product: e.target.value }))} />
          <Input placeholder="Price ₹" type="number" min={0} value={comp.price} onChange={e => setComp(c => ({ ...c, price: e.target.value }))} />
          <Button size="sm" variant="outline" onClick={addCompetitor}>Add</Button>
        </div>
      </Section>

      <Section title="Recent Diary" count={d.diary.length} report="customer_follow_up" customerId={customerId}>
        <Rows items={d.diary} empty="No Diary entries." render={n => (
          <Row key={n.id}><span className="min-w-0 flex-1 truncate">{n.content}</span><span className="text-xs text-muted-foreground">{formatDate(n.visit_date || n.created_at)} · {n.created_by}</span></Row>
        )} />
      </Section>
    </div>
  );
}
