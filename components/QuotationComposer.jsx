'use client';

// One page for the whole Commercial Offer: build the quotation, pick the email template, review the
// customer/quotation facts, edit the email, preview the PDF and send. Replaces the two overlays
// (New Quotation + Send Commercial Offer) for Sales; Marketing's Pipeline still uses the overlays.
// Modes (from the address): ?lead=<enquiry id> starts from the enquiry's products, ?revise=<quotation id>
// saves a revision, ?send=<quotation id> only sends an existing quotation, ?customer=<id> pre-picks one.
import { useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowLeftIcon, PlusIcon, TrashIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import SearchableSelect from '@/components/SearchableSelect';
import CustomerPicker from '@/components/CustomerPicker';
import ProductSearchField from '@/components/ProductSearchField';
import ProductPickerDialog from '@/components/ProductPickerDialog';
import { api, showToast } from '@/lib/client';
import { todayISO } from '@/lib/date';
import { formatMoney, formatDate } from '@/lib/format';
import { lineAmount, quotationTotals } from '@/lib/sales-lines.mjs';
import { QTY_UNITS } from '@/lib/qty-units.mjs';
import { renderTemplate } from '@/lib/email-template.mjs';
import { COMPANY_NAMES } from '@/lib/company-profiles.js';
import { defaultCompanyClient } from '@/lib/company-filter.mjs';

const UNIT_OPTIONS = QTY_UNITS.map(u => ({ value: u, label: u }));
const TYPES = ['Sales', 'Service', 'Spares', 'AMC'];
const blankLine = () => ({ item_description: '', qty: 1, uom: 'Nos', rate: 0, discount_pct: 0, gst_pct: '', product_id: null, hsn_code: '', item_id: null });
const lineFromProduct = p => ({ ...blankLine(), item_description: p.product_name, product_id: p.id, uom: p.unit || 'Nos', rate: p.price ?? 0, gst_pct: p.gst_pct ?? '', hsn_code: p.hsn_code || '' });
const GRID = 'md:grid-cols-[minmax(0,1fr)_4rem_5.5rem_6.5rem_4.5rem_4.5rem_6rem_2rem]';

function Fact({ label, value }) {
  return (
    <div className="min-w-0">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="truncate text-sm font-medium" title={value || ''}>{value || '—'}</div>
    </div>
  );
}

export default function QuotationComposer({ salesProducts = [], leadId = null, reviseId = null, sendId = null, customerId: startCustomer = '' }) {
  const router = useRouter();
  const [customerId, setCustomerId] = useState(startCustomer ? String(startCustomer) : '');
  const [customer, setCustomer] = useState(null);
  const [company, setCompany] = useState(() => defaultCompanyClient());
  const [type, setType] = useState('Sales');
  const [date, setDate] = useState(todayISO());
  const [validUntil, setValidUntil] = useState(() => { const d = new Date(); d.setDate(d.getDate() + 15); return d.toISOString().slice(0, 10); });
  const [offerNo, setOfferNo] = useState('');
  const [taxPct, setTaxPct] = useState('18');
  const [items, setItems] = useState([blankLine()]);
  const [picking, setPicking] = useState(false);
  const [parent, setParent] = useState(null); // quotation being revised
  const [saved, setSaved] = useState(null); // { id, no }
  const [busy, setBusy] = useState(false);
  const [lead, setLead] = useState(null);

  const [templates, setTemplates] = useState([]);
  const [templateId, setTemplateId] = useState('');
  const [to, setTo] = useState('');
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const touched = useRef(false); // true once the user edited subject/body by hand

  const locked = !!saved;
  const preview = useMemo(() => quotationTotals(items.filter(it => it.item_description.trim()), { fallbackGstPct: taxPct === '' ? 18 : Number(taxPct) }), [items, taxPct]);
  const quotationNo = saved?.no || offerNo.trim() || '(assigned on save)';
  const template = templates.find(t => String(t.id) === templateId);

  // ---- load starting data ----
  useEffect(() => {
    api('/api/email-templates?active=1').then(rows => setTemplates(rows)).catch(() => {});
    if (sendId) {
      api(`/api/quotations/${sendId}`).then(q => {
        setSaved({ id: q.id, no: q.quotation_no });
        setCustomerId(String(q.customer_id)); setCompany(q.company || defaultCompanyClient()); setType(q.quotation_type || 'Sales');
        setDate(q.quotation_date?.slice(0, 10) || todayISO()); setValidUntil(q.valid_until?.slice(0, 10) || '');
        setItems(q.items.map(it => ({ ...blankLine(), item_description: it.item_description, qty: it.qty, uom: it.uom, rate: it.rate, discount_pct: it.discount_pct, gst_pct: it.gst_pct ?? '' })));
      }).catch(err => showToast(err.message, 'error'));
    } else if (reviseId) {
      api(`/api/quotations/${reviseId}`).then(q => {
        setParent(q);
        setCustomerId(String(q.customer_id)); setCompany(q.company || defaultCompanyClient()); setType(q.quotation_type || 'Sales');
        setItems(q.items.map(it => ({ ...blankLine(), item_description: it.item_description, qty: it.qty ?? 1, uom: it.uom || 'Nos', rate: it.rate ?? 0,
          discount_pct: it.discount_pct ?? 0, gst_pct: it.gst_pct ?? '', product_id: it.product_id || null, hsn_code: it.hsn_code || '' })));
      }).catch(err => showToast(err.message, 'error'));
    } else if (leadId) {
      api(`/api/leads/${leadId}`).then(l => {
        setLead(l);
        if (l.converted_customer_id && !startCustomer) setCustomerId(String(l.converted_customer_id));
        const byId = new Map(salesProducts.map(p => [p.id, p]));
        const lines = (l.products || []).map(p => ({ ...blankLine(), item_description: p.description, qty: p.qty ?? 1, uom: p.unit || 'Nos', rate: p.rate ?? '',
          gst_pct: p.gst_pct ?? '', product_id: p.product_id || null, hsn_code: byId.get(p.product_id)?.hsn_code || '' }));
        if (lines.length) setItems(lines);
      }).catch(err => showToast(err.message, 'error'));
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!customerId) { setCustomer(null); return; }
    api(`/api/customers/${customerId}`).then(c => { setCustomer(c); setTo(prev => prev || c.email || ''); }).catch(() => {});
  }, [customerId]);

  // Keep the template on the quotation's company: on load, when a saved quotation's company arrives,
  // and when the company is changed. chooseTemplate sets both together, so this is then a no-op.
  useEffect(() => {
    if (!templates.length || template?.company === company) return;
    const t = templates.find(x => x.company === company) || (!templateId && !locked ? templates[0] : null);
    if (!t) return;
    touched.current = false;
    setTemplateId(String(t.id));
    if (t.company !== company) setCompany(t.company);
  }, [templates, company]); // eslint-disable-line react-hooks/exhaustive-deps

  // Fill subject/body from the template; follows quotation number/total/validity until edited by hand.
  useEffect(() => {
    if (!template || touched.current) return;
    const vars = { customer_name: customer?.name || '', quotation_no: quotationNo, total: formatMoney(preview.total), valid_until: validUntil ? formatDate(validUntil) : '' };
    setSubject(renderTemplate(template.subject || '', vars));
    setBody(renderTemplate(template.body, vars) + (template.regards ? `\n\n${renderTemplate(template.regards, vars)}` : ''));
  }, [template, customer?.name, quotationNo, preview.total, validUntil]); // eslint-disable-line react-hooks/exhaustive-deps

  function chooseTemplate(id) {
    const t = templates.find(x => String(x.id) === id);
    touched.current = false; // a template change always rewrites the email
    setTemplateId(id);
    if (t && t.company !== company) setCompany(t.company);
  }
  const chooseCompany = c => setCompany(c); // the effect above then picks that company's template

  // ---- lines ----
  const patch = (i, p) => setItems(prev => prev.map((it, k) => (k === i ? { ...it, ...p } : it)));
  const priceListRate = async (productId, custId) => { try { return await api(`/api/price-lists?product_id=${productId}${custId ? `&customer_id=${custId}` : ''}`); } catch { return null; } };
  async function pickProduct(i, p) {
    patch(i, { item_description: p.product_name, product_id: p.id, uom: p.unit || items[i].uom, rate: p.price ?? items[i].rate, gst_pct: p.gst_pct ?? items[i].gst_pct, hsn_code: p.hsn_code || '' });
    const pl = await priceListRate(p.id, customerId);
    if (pl) patch(i, { rate: pl.rate });
  }
  function addPicked(ps) {
    const kept = items.filter(it => it.item_description.trim());
    setItems([...kept, ...ps.map(lineFromProduct)]);
    ps.forEach((p, k) => priceListRate(p.id, customerId).then(pl => { if (pl) patch(kept.length + k, { rate: pl.rate }); }));
  }
  useEffect(() => { // customer changed after products were picked: re-check price lists
    if (!customerId || locked) return;
    items.forEach((it, i) => { if (it.product_id) priceListRate(it.product_id, customerId).then(pl => { if (pl) patch(i, { rate: pl.rate }); }); });
  }, [customerId]); // eslint-disable-line react-hooks/exhaustive-deps

  // ---- actions ----
  async function save() {
    if (saved) return saved;
    if (!customerId) { showToast('Customer is required', 'error'); return null; }
    const clean = items.filter(it => it.item_description.trim());
    if (!clean.length) { showToast('At least one line item is required', 'error'); return null; }
    const res = await api('/api/quotations', {
      method: 'POST',
      body: {
        customer_id: customerId, opportunity_id: parent?.opportunity_id || null, lead_id: leadId || parent?.lead_id || null,
        tax_pct: taxPct === '' ? 18 : Number(taxPct), items: clean, company, quotation_type: type,
        quotation_no: offerNo.trim() || undefined, quotation_date: date, valid_until: validUntil,
        revision_of: parent?.id || null, terms: parent?.terms || null, notes: parent?.notes || null,
      },
    });
    const s = { id: res.id, no: res.quotation_no };
    setSaved(s);
    return s;
  }
  async function onSave() {
    setBusy(true);
    try { const s = await save(); if (s) showToast(`Quotation ${s.no} ${parent ? 'saved as a revision' : 'created'}`); }
    catch (err) { showToast(err.message, 'error'); } finally { setBusy(false); }
  }
  async function onSend() {
    if (!subject.trim() || !body.trim()) return showToast('Subject and body are required', 'error');
    if (!/^\S+@\S+\.\S+$/.test(to.trim())) return showToast('Enter the customer\'s email address in "To"', 'error');
    setBusy(true);
    try {
      const s = await save();
      if (!s) return;
      const res = await api(`/api/quotations/${s.id}/send-email`, { method: 'POST', body: { to: to.trim(), subject: subject.trim(), body: body.trim(), email_template_id: templateId || null } });
      showToast(res.live === false ? res.note : 'Commercial Offer emailed');
      router.push('/sales/quotations');
      router.refresh();
    } catch (err) { showToast(err.message, 'error'); } finally { setBusy(false); }
  }

  const address = customer ? [customer.address, customer.city, customer.state, customer.pin_code].filter(Boolean).join(', ') : '';
  const pdfHref = saved ? `/api/quotations/${saved.id}/pdf${templateId ? `?template_id=${templateId}` : ''}` : null;

  return (
    <div className="container flex flex-col gap-4 py-4">
      <div className="flex items-center gap-3">
        <Button variant="outline" size="sm" onClick={() => router.push(leadId ? '/sales/leads' : '/sales/quotations')}><ArrowLeftIcon className="size-4" />Back</Button>
        <h1 className="text-lg font-semibold">{sendId ? 'Send Commercial Offer' : parent ? `Revise ${parent.quotation_no}` : 'New Commercial Offer'}</h1>
        {saved && <span className="text-sm text-muted-foreground">Quotation {saved.no} saved</span>}
      </div>

      <Card>
        <CardHeader><CardTitle>1. Quotation</CardTitle><CardDescription>{locked ? 'Saved — create a revision from the Quotations list to change it.' : 'Customer, dates and products.'}</CardDescription></CardHeader>
        <CardContent>
          <fieldset disabled={locked} className="flex min-w-0 flex-col gap-4 border-0 p-0">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <div className="grid gap-1.5"><Label>Customer</Label>
                <CustomerPicker value={customerId} name={customer?.name || lead?.company_name || lead?.lead_name || ''} onChange={(id) => setCustomerId(id)} placeholder="Choose customer" /></div>
              <div className="grid gap-1.5"><Label>Quotation type</Label>
                <SearchableSelect value={type} onChange={setType} options={TYPES.map(t => ({ value: t, label: t }))} displayValue={type} onTextChange={setType} placeholder="Select or type…" /></div>
              {!parent && !saved && <div className="grid gap-1.5"><Label>Offer Number</Label><Input value={offerNo} onChange={e => setOfferNo(e.target.value)} placeholder="Auto" /></div>}
              <div className="grid gap-1.5"><Label>Quotation date</Label><Input type="date" value={date} onChange={e => setDate(e.target.value)} /></div>
              <div className="grid gap-1.5"><Label>Valid until</Label><Input type="date" value={validUntil} onChange={e => setValidUntil(e.target.value)} /></div>
              <div className="grid gap-1.5"><Label>Default GST %</Label><Input type="number" min="0" max="100" value={taxPct} onChange={e => setTaxPct(e.target.value)} /></div>
            </div>

            <div className="flex flex-col gap-2">
              <Label>Line items</Label>
              <div className={`hidden gap-2 text-xs text-muted-foreground md:grid ${GRID}`}>
                <span>Product</span><span>Qty</span><span>Unit</span><span>Rate (₹)</span><span>Disc %</span><span>GST %</span><span className="text-right">Amount</span><span />
              </div>
              {items.map((it, i) => (
                <div key={i} className={`grid grid-cols-2 gap-2 rounded-md border p-2 md:items-start md:border-0 md:p-0 ${GRID}`}>
                  <div className="col-span-2 md:col-span-1">
                    <ProductSearchField products={salesProducts} value={it.item_description} onChange={v => patch(i, { item_description: v, product_id: null })} onPick={p => pickProduct(i, p)} />
                    {it.product_id && <div className="mt-0.5 text-xs text-muted-foreground">From Product Master{it.hsn_code ? ` · HSN ${it.hsn_code}` : ''}</div>}
                  </div>
                  <Input aria-label="Qty" type="number" min="0" value={it.qty} onChange={e => patch(i, { qty: e.target.value })} />
                  <SearchableSelect value={it.uom} onChange={v => patch(i, { uom: v })} options={UNIT_OPTIONS} displayValue={it.uom} onTextChange={v => patch(i, { uom: v })} placeholder="Unit" />
                  <Input aria-label="Rate" type="number" min="0" value={it.rate} onChange={e => patch(i, { rate: e.target.value })} />
                  <Input aria-label="Discount %" type="number" min="0" max="100" value={it.discount_pct} onChange={e => patch(i, { discount_pct: e.target.value })} />
                  <Input aria-label="GST %" placeholder={taxPct || '18'} type="number" min="0" max="100" value={it.gst_pct} onChange={e => patch(i, { gst_pct: e.target.value })} />
                  <div className="self-center text-right text-sm tnum">{formatMoney(lineAmount(it))}</div>
                  <Button size="icon" variant="ghost" aria-label="Remove line" onClick={() => setItems(prev => prev.filter((_, k) => k !== i))}><TrashIcon className="size-4" /></Button>
                </div>
              ))}
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="flex gap-2">
                  <Button size="sm" variant="outline" onClick={() => setItems(prev => [...prev, blankLine()])}><PlusIcon />Add line</Button>
                  <Button size="sm" variant="outline" onClick={() => setPicking(true)}>Choose from product list</Button>
                </div>
                <div className="min-w-56 text-sm">
                  <div className="flex justify-between gap-4"><span className="text-muted-foreground">Sub total</span><span className="tnum">{formatMoney(preview.subtotal)}</span></div>
                  <div className="flex justify-between gap-4"><span className="text-muted-foreground">GST</span><span className="tnum">{formatMoney(preview.taxAmount)}</span></div>
                  <div className="flex justify-between gap-4 border-t pt-1 font-semibold"><span>Total</span><span className="tnum">{formatMoney(preview.total)}</span></div>
                  <p className="mt-1 text-xs text-muted-foreground">Split into CGST + SGST or IGST from the customer's state on save.</p>
                </div>
              </div>
            </div>
          </fieldset>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>2. Email the offer</CardTitle><CardDescription>Choosing a template picks its company and writes the email.</CardDescription></CardHeader>
        <CardContent className="flex flex-col gap-4">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="grid gap-1.5"><Label>Template</Label>
              <Select value={templateId} onValueChange={chooseTemplate}>
                <SelectTrigger><SelectValue placeholder={templates.length ? 'Choose template' : 'No templates'} /></SelectTrigger>
                <SelectContent>{templates.filter(t => !locked || t.company === company).map(t => <SelectItem key={t.id} value={String(t.id)}>{t.name} — {t.company}</SelectItem>)}</SelectContent>
              </Select></div>
            <div className="grid gap-1.5"><Label>Company</Label>
              <Select value={company} onValueChange={chooseCompany} disabled={locked}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>{COMPANY_NAMES.map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}</SelectContent>
              </Select></div>
          </div>

          <div className="grid grid-cols-2 gap-3 rounded-md border bg-muted/30 p-3 lg:grid-cols-3">
            <Fact label="Customer name" value={customer?.name} />
            <Fact label="Customer address" value={address} />
            <Fact label="Quotation number" value={quotationNo} />
            <Fact label="Quotation date" value={date ? formatDate(date) : ''} />
            <Fact label="Valid until" value={validUntil ? formatDate(validUntil) : ''} />
            <Fact label="Quotation type" value={type} />
          </div>

          <div className="grid gap-1.5"><Label>Email to</Label><Input type="email" placeholder="customer@example.com" value={to} onChange={e => setTo(e.target.value)} /></div>
          <div className="grid gap-1.5"><Label>Subject</Label><Input value={subject} onChange={e => { touched.current = true; setSubject(e.target.value); }} /></div>
          <div className="grid gap-1.5"><Label>Body</Label>
            <Textarea className="max-h-72 min-h-48 overflow-y-auto" rows={10} value={body} onChange={e => { touched.current = true; setBody(e.target.value); }} /></div>

          {template && !template.terms && <p className="text-xs text-amber-600">This template has no Terms and Conditions yet — the PDF will have none. Add them under Setup → Masters → Email Templates.</p>}
          <div className="flex flex-wrap items-center justify-end gap-2 border-t pt-3">
            {pdfHref ? <Button variant="outline" asChild><a href={pdfHref} target="_blank" rel="noopener noreferrer">Preview PDF</a></Button>
              : <span className="mr-auto text-xs text-muted-foreground">Save the quotation to preview the PDF.</span>}
            {!locked && <Button variant="outline" onClick={onSave} disabled={busy}>{busy ? 'Saving…' : 'Save quotation'}</Button>}
            <Button onClick={onSend} disabled={busy}>{busy ? 'Working…' : locked ? 'Send email' : 'Save & send email'}</Button>
          </div>
        </CardContent>
      </Card>
      {picking && <ProductPickerDialog onClose={() => setPicking(false)} onAdd={addPicked} />}
    </div>
  );
}
