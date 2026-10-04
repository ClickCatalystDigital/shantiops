'use client';

// Accounts → Company Entities → Document headers. Pick a document, choose where the logo sits, the
// title's font and size, and a footer line; the page preview follows. Rules and document list:
// lib/doc-headers.mjs. The PDFs read the same saved choices (lib/report-pdf.js DocIdentity).
import { useEffect, useMemo, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardAction, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectTrigger, SelectValue } from '@/components/ui/select';
import { LayoutTemplateIcon, MinusIcon, PlusIcon, RotateCcwIcon } from 'lucide-react';
import { api, showToast } from '@/lib/client';
import { DOCS, DOC_FONTS, LOGO_POSITIONS, docHeader, parseDocHeaders, cleanDocHeaders } from '@/lib/doc-headers.mjs';
import { logoBox } from '@/lib/logo-box.mjs';

const GROUPS = [...new Set(DOCS.map(d => d.group))];
const POS_LABEL = { none: 'No logo', left: 'Left', center: 'Centre', right: 'Right' };

function Segmented({ value, options, onChange, disabled }) {
  return (
    <div className="inline-flex rounded-lg border bg-muted/50 p-0.5">
      {options.map(([v, label]) => (
        <button key={v} type="button" disabled={disabled} onClick={() => onChange(v)}
          className={`rounded-md px-3 py-1.5 text-xs font-medium transition-colors disabled:opacity-50 ${value === v ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'}`}>
          {label}
        </button>
      ))}
    </div>
  );
}

// The top and bottom of the printed page, 1 px = 1 pt.
function PagePreview({ entity, def, cfg }) {
  const name = entity.print_name || String(entity.legal_name || entity.company || '').toUpperCase();
  const sub = [entity.registered_address, entity.gstin && `GST: ${entity.gstin}`, entity.phone && `Ph: ${entity.phone}`].filter(Boolean).join(' · ');
  const box = logoBox(entity.logo_w, entity.logo_h, cfg.box[0], cfg.box[1]);
  const img = cfg.logo !== 'none' && (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={`/api/company-settings/${entity.id}/logo?v=${encodeURIComponent(entity.logo_key)}`} alt="" style={{ width: box.width, height: box.height, objectFit: 'contain', flexShrink: 0 }} />
  );
  const nameEl = (cfg.logo === 'none' || !box.wide) && <div className="text-[13px] font-bold">{name}</div>;
  const subEl = cfg.sub && sub && <div className="mt-0.5 text-[7px] text-[#555]">{sub}</div>;
  return (
    <div className="overflow-x-auto rounded-lg border bg-muted/30 p-4">
      <div className="mx-auto flex min-h-[250px] flex-col bg-white p-7 text-black shadow-sm ring-1 ring-black/5" style={{ width: 595 }}>
        {cfg.logo === 'none' || cfg.logo === 'center'
          ? <div className="flex flex-col items-center text-center">{img}<div className={img ? 'mt-1' : ''}>{nameEl}{subEl}</div></div>
          : <div className={`flex items-center gap-3 ${cfg.logo === 'right' ? 'flex-row-reverse' : ''}`}>{img}<div className={`flex-1 ${cfg.logo === 'left' ? 'text-right' : 'text-left'}`}>{nameEl}{subEl}</div></div>}
        <div className="mt-2 text-center font-bold" style={{ fontFamily: DOC_FONTS[cfg.font].css, fontSize: cfg.size }}>{def.title}</div>
        <div className="mt-3 flex flex-1 flex-col gap-1.5">
          {[100, 92, 96, 70].map((w, i) => <div key={i} className="h-1.5 rounded bg-black/[0.07]" style={{ width: `${w}%` }} />)}
        </div>
        {cfg.footer && <div className="mt-3 text-center text-[6.5px] text-[#555]">{cfg.footer}</div>}
        <div className="mt-1 border-t border-black/15 pt-1 text-center text-[6px] text-[#888]">Page 1 of 1</div>
      </div>
    </div>
  );
}

export default function DocumentHeadersCard({ entity, onSaved }) {
  const [all, setAll] = useState(() => parseDocHeaders(entity.doc_headers_json));
  const [key, setKey] = useState('po');
  const [saving, setSaving] = useState(false);
  useEffect(() => { setAll(parseDocHeaders(entity.doc_headers_json)); }, [entity.id, entity.doc_headers_json]);

  const hasLogo = !!entity.logo_key;
  const def = DOCS.find(d => d.key === key);
  const cfg = useMemo(() => docHeader(all, key, hasLogo), [all, key, hasLogo]);
  const dirty = JSON.stringify(cleanDocHeaders(all)) !== JSON.stringify(cleanDocHeaders(entity.doc_headers_json));
  const set = patch => setAll(a => ({ ...a, [key]: { ...a[key], ...patch } }));
  const changed = Object.keys(cleanDocHeaders({ [key]: all[key] })).length > 0;

  async function save() {
    setSaving(true);
    try {
      await api('/api/company-settings', { method: 'PATCH', body: { id: entity.id, doc_headers: all } });
      showToast('Document headers saved'); onSaved();
    } catch (err) { showToast(err.message, 'error'); } finally { setSaving(false); }
  }
  function applyToAll() {
    const { logo, font, footer } = cfg; // size stays per document: titles differ in size by design
    setAll(a => Object.fromEntries(DOCS.map(d => [d.key, { ...a[d.key], logo, font, footer }])));
    showToast('Logo position, font and footer copied to every document. Save to keep.');
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2"><LayoutTemplateIcon className="size-4" />Document headers</CardTitle>
        <CardDescription>Where the logo sits, how the title looks and what the footer says, for each document.</CardDescription>
        <CardAction><Button size="sm" onClick={save} disabled={saving || !dirty}>{saving ? 'Saving…' : 'Save'}</Button></CardAction>
      </CardHeader>
      <CardContent className="grid gap-6 lg:grid-cols-[18rem_1fr]">
        <div className="flex flex-col gap-5">
          <div className="grid gap-1.5">
            <Label>Document</Label>
            <Select value={key} onValueChange={setKey}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {GROUPS.map(g => (
                  <SelectGroup key={g}>
                    <SelectLabel>{g}</SelectLabel>
                    {DOCS.filter(d => d.group === g).map(d => <SelectItem key={d.key} value={d.key}>{d.label}</SelectItem>)}
                  </SelectGroup>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="grid gap-1.5">
            <Label>Logo</Label>
            <Segmented value={cfg.logo} disabled={!hasLogo} onChange={logo => set({ logo })} options={LOGO_POSITIONS.map(p => [p, POS_LABEL[p]])} />
            {!hasLogo && <p className="text-xs text-muted-foreground">Upload a logo above to place it on documents.</p>}
          </div>
          <div className="grid gap-1.5">
            <Label>Title font</Label>
            <Segmented value={cfg.font} onChange={font => set({ font })} options={Object.entries(DOC_FONTS).map(([k, f]) => [k, f.label])} />
          </div>
          <div className="grid gap-1.5">
            <Label>Title size</Label>
            <div className="flex items-center gap-2">
              <Button type="button" size="icon" variant="outline" className="size-8" disabled={cfg.size <= 7} onClick={() => set({ size: cfg.size - 0.5 })}><MinusIcon className="size-3.5" /></Button>
              <span className="w-14 text-center text-sm tabular-nums">{cfg.size} pt</span>
              <Button type="button" size="icon" variant="outline" className="size-8" disabled={cfg.size >= 24} onClick={() => set({ size: cfg.size + 0.5 })}><PlusIcon className="size-3.5" /></Button>
            </div>
          </div>
          <div className="grid gap-1.5">
            <Label>Footer line</Label>
            <Input value={all[key]?.footer ?? ''} maxLength={200} placeholder="Optional, printed at the bottom of every page" onChange={e => set({ footer: e.target.value })} />
          </div>
          <div className="flex flex-wrap gap-2">
            <Button type="button" size="sm" variant="outline" onClick={applyToAll}>Apply to all documents</Button>
            <Button type="button" size="sm" variant="ghost" disabled={!changed} onClick={() => setAll(({ [key]: _drop, ...rest }) => rest)}><RotateCcwIcon className="size-3.5" />Reset</Button>
          </div>
        </div>
        <div className="flex min-w-0 flex-col gap-2">
          <PagePreview entity={entity} def={def} cfg={cfg} />
          <p className="text-xs text-muted-foreground">
            A wide logo that already shows the company name is printed without the name beside it; the address line stays.
            QC statutory forms, the nameplate sticker and stock tags keep their fixed layout.
          </p>
        </div>
      </CardContent>
    </Card>
  );
}
