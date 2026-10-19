'use client';
// One shop group (SYSTEM.md §5fh). Equipment = cards with filters; items in the group that are sold
// by the piece show below as "Parts & accessories". Spares = a compact table. Services = a list.
// Clicking anything opens the detail sheet (deep link: ?item=<id>).
import { useMemo, useState, useEffect } from 'react';
import Link from 'next/link';
import { ChevronRight, Check, Plus, Search } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from '@/components/ui/sheet';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Visual, PhotoEdit, useShop, GroupIcon } from './ShopShell';

const capKey = i => i.capacity?.label;
function facets(items, kind) {
  const defs = kind === 'spares'
    ? [['Material', i => i.spare.material], ['IBR', i => i.spare.ibr], ['Rating', i => i.spare.rating], ['Size', i => i.spare.size]]
    : [['Fuel', i => i.fuels], ['Output', capKey], ['Pressure', i => i.pressure?.label], ['Design', i => i.back]];
  return defs.map(([label, get]) => {
    const vals = new Map();
    for (const i of items) for (const v of [].concat(get(i) || [])) vals.set(v, (vals.get(v) || 0) + 1);
    let opts = [...vals.keys()];
    const n = s => parseFloat(String(s).replace(/,/g, '')) || 0;
    opts.sort((a, b) => n(a) - n(b) || String(a).localeCompare(String(b)));
    return { label, get, opts };
  }).filter(f => f.opts.length > 1 && f.opts.length <= 30);
}

function AddButton({ item, size = 'sm' }) {
  const { has, add, remove } = useShop();
  const inBasket = has(item.id);
  return (
    <Button size={size} variant={inBasket ? 'secondary' : 'default'} onClick={e => { e.stopPropagation(); inBasket ? remove(item.id) : add(item); }}>
      {inBasket ? <><Check className="size-4" />Added</> : <><Plus className="size-4" />Add to quote</>}
    </Button>
  );
}

export default function ShopGroup({ group, section, items, addOns, initialItem }) {
  const { canEdit } = useShop();
  const [images, setImages] = useState({}); // photo changes made here, by product id / 'group'
  const [sel, setSel] = useState({});
  const [q, setQ] = useState('');
  const [openId, setOpenId] = useState(initialItem || null);
  useEffect(() => { // keep ?item= in the address so a sheet can be shared or reloaded
    const u = new URL(window.location.href);
    if (openId) u.searchParams.set('item', openId); else u.searchParams.delete('item');
    window.history.replaceState(null, '', u);
  }, [openId]);

  const imageOf = i => (i.id in images ? images[i.id] : i.image_key);
  const groupImage = 'group' in images ? images.group : group.image;
  const main = group.kind === 'equipment' ? items.filter(i => i.isSet) : items;
  const parts = group.kind === 'equipment' ? items.filter(i => !i.isSet) : [];
  const fs = useMemo(() => facets(main, group.kind), [main, group.kind]);
  const shown = useMemo(() => {
    const words = q.toLowerCase().split(/\s+/).filter(Boolean);
    return main.filter(i => fs.every(f => !sel[f.label] || [].concat(f.get(i) || []).includes(sel[f.label]))
      && words.every(w => `${i.title} ${i.name} ${i.model || ''}`.toLowerCase().includes(w)))
      .sort((a, b) => (a.capacity?.value ?? 1e9) - (b.capacity?.value ?? 1e9) || a.name.localeCompare(b.name));
  }, [main, fs, sel, q]);
  const open = items.find(i => i.id === Number(openId)) || null;

  return (
    <main className="container flex flex-col gap-6 py-6">
      <nav className="flex items-center gap-1 text-sm text-muted-foreground">
        <Link href="/shop" className="hover:text-foreground">Shop</Link><ChevronRight className="size-4" /><span>{section.label}</span>
      </nav>
      <header className="flex flex-col gap-4 sm:flex-row sm:items-center">
        <Visual image={groupImage} icon={group.icon} className="aspect-[16/9] w-full rounded-xl sm:w-56" iconClass="size-12" />
        <div className="flex flex-1 flex-col gap-1">
          <h1 className="text-2xl font-bold tracking-tight">{group.label}</h1>
          <p className="text-muted-foreground">{group.blurb}</p>
          <p className="text-sm text-muted-foreground">{main.length} {group.kind === 'services' ? 'services' : 'items'}{parts.length ? ` · ${parts.length} parts & accessories` : ''}</p>
          {canEdit && <div className="pt-1"><PhotoEdit groupKey={group.key} hasImage={!!groupImage} onChanged={k => setImages(m => ({ ...m, group: k }))} /></div>}
        </div>
      </header>

      <div className="flex flex-col gap-3 rounded-xl border bg-card p-3">
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input className="pl-9" placeholder={`Search ${group.label.toLowerCase()}`} value={q} onChange={e => setQ(e.target.value)} />
        </div>
        {fs.map(f => (
          <div key={f.label} className="flex flex-wrap items-center gap-1.5">
            <span className="w-20 shrink-0 text-xs font-medium text-muted-foreground">{f.label}</span>
            {f.opts.map(o => (
              <button key={o} type="button" onClick={() => setSel(s => ({ ...s, [f.label]: s[f.label] === o ? null : o }))}
                className={`rounded-full border px-2.5 py-1 text-xs transition ${sel[f.label] === o ? 'border-primary bg-primary text-primary-foreground' : 'hover:border-primary/50'}`}>{o}</button>
            ))}
          </div>
        ))}
        <div className="text-xs text-muted-foreground">{shown.length} shown</div>
      </div>

      {group.kind === 'equipment' && (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {shown.map(i => (
            <div key={i.id} role="button" tabIndex={0} onClick={() => setOpenId(i.id)} onKeyDown={e => e.key === 'Enter' && setOpenId(i.id)}
              className="flex cursor-pointer flex-col overflow-hidden rounded-xl border bg-card text-left transition hover:-translate-y-0.5 hover:border-primary/40 hover:shadow-md">
              <Visual image={imageOf(i) || groupImage} icon={group.icon} className="aspect-[16/10]" />
              <div className="flex flex-1 flex-col gap-2 p-4">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="font-semibold">{i.title}</div>
                    <div className="truncate text-xs text-muted-foreground">{[i.series, i.model].filter(Boolean).join(' · ')}</div>
                  </div>
                </div>
                <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground">
                  {i.pressure && <span>{i.pressure.label}</span>}
                  {i.passes && <span>{i.passes}-pass</span>}
                  {i.back && <span>{i.back}</span>}
                  {i.chimney && <span>{i.chimney}</span>}
                </div>
                {i.fuels.length > 0 && <div className="flex flex-wrap gap-1">{i.fuels.slice(0, 4).map(f => <Badge key={f} variant="secondary" className="font-normal">{f}</Badge>)}</div>}
                <div className="mt-auto flex items-center justify-between pt-2">
                  <span className="text-xs text-primary">Details</span>
                  <AddButton item={i} />
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {(group.kind === 'spares' || parts.length > 0) && (
        <div className="flex flex-col gap-2">
          {parts.length > 0 && <h2 className="text-lg font-semibold">Parts & accessories</h2>}
          <SpareTable rows={group.kind === 'spares' ? shown : parts} onOpen={setOpenId} />
        </div>
      )}

      {group.kind === 'services' && (
        <ul className="flex flex-col gap-3">
          {shown.map(i => (
            <li key={i.id} role="button" tabIndex={0} onClick={() => setOpenId(i.id)} onKeyDown={e => e.key === 'Enter' && setOpenId(i.id)}
              className="flex cursor-pointer items-center gap-4 rounded-xl border bg-card p-4 transition hover:border-primary/40">
              <div className="grid size-10 shrink-0 place-items-center rounded-lg bg-primary/10 text-primary"><GroupIcon name={group.icon} className="size-5" /></div>
              <div className="min-w-0 flex-1">
                <div className="font-medium">{i.name}</div>
                {i.intro && <p className="line-clamp-2 text-sm text-muted-foreground">{i.intro}</p>}
              </div>
              <AddButton item={i} />
            </li>
          ))}
        </ul>
      )}

      {shown.length === 0 && <p className="py-10 text-center text-sm text-muted-foreground">Nothing matches these filters.</p>}

      <ProductSheet item={open} group={group} addOns={open ? addOns[open.id] || [] : []} image={open ? imageOf(open) : null}
        groupImage={groupImage} canEdit={canEdit} onClose={() => setOpenId(null)}
        onImage={k => open && setImages(m => ({ ...m, [open.id]: k }))} />
    </main>
  );
}

function SpareTable({ rows, onOpen }) {
  if (!rows.length) return null;
  return (
    <>
      <div className="hidden overflow-hidden rounded-xl border bg-card md:block">
        <Table>
          <TableHeader><TableRow>
            <TableHead>Item</TableHead><TableHead>Size</TableHead><TableHead>Material</TableHead>
            <TableHead>IBR</TableHead><TableHead>Rating</TableHead><TableHead>Make</TableHead><TableHead className="w-36" />
          </TableRow></TableHeader>
          <TableBody>
            {rows.map(i => (
              <TableRow key={i.id} className="cursor-pointer" onClick={() => onOpen(i.id)}>
                <TableCell className="max-w-sm"><div className="truncate font-medium">{i.name}</div></TableCell>
                <TableCell>{i.spare.size || '—'}</TableCell>
                <TableCell>{i.spare.material || '—'}</TableCell>
                <TableCell>{i.spare.ibr || '—'}</TableCell>
                <TableCell>{i.spare.rating || '—'}</TableCell>
                <TableCell className="max-w-40 truncate">{i.spare.make || '—'}</TableCell>
                <TableCell className="text-right"><AddButton item={i} /></TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
      <ul className="flex flex-col gap-2 md:hidden">
        {rows.map(i => (
          <li key={i.id} onClick={() => onOpen(i.id)} className="flex items-center gap-3 rounded-xl border bg-card p-3">
            <div className="min-w-0 flex-1">
              <div className="text-sm font-medium">{i.name}</div>
              <div className="text-xs text-muted-foreground">{[i.spare.size, i.spare.material, i.spare.ibr, i.spare.rating].filter(Boolean).join(' · ')}</div>
            </div>
            <AddButton item={i} />
          </li>
        ))}
      </ul>
    </>
  );
}

function Fact({ label, value }) {
  if (!value) return null;
  return <div className="rounded-lg border bg-muted/30 px-3 py-2"><div className="text-xs text-muted-foreground">{label}</div><div className="text-sm font-medium">{value}</div></div>;
}

function ProductSheet({ item, group, addOns, image, groupImage, canEdit, onClose, onImage }) {
  const { has, add } = useShop();
  return (
    <Sheet open={!!item} onOpenChange={v => !v && onClose()}>
      <SheetContent className="w-full gap-0 overflow-y-auto p-6 data-[side=right]:sm:max-w-xl">
        {item && (
          <div className="flex flex-col gap-5 pb-8">
            <Visual image={image || groupImage} icon={group.icon} className="-mx-6 -mt-6 aspect-[16/9]" iconClass="size-16" />
            <SheetHeader className="p-0">
              <SheetTitle className="text-xl">{item.title}</SheetTitle>
              <SheetDescription>{[item.series, item.model, item.title !== item.name ? item.name : null].filter(Boolean).join(' · ')}</SheetDescription>
            </SheetHeader>
            {canEdit && <PhotoEdit productId={item.id} hasImage={!!image} onChanged={onImage} />}
            <div className="grid grid-cols-2 gap-2">
              <Fact label="Output" value={item.capacity?.label} />
              <Fact label="Working pressure" value={item.pressure?.label} />
              <Fact label="Passes" value={item.passes && `${item.passes}-pass`} />
              <Fact label="Design" value={item.back} />
              <Fact label="Burner" value={item.burner} />
              <Fact label="Size" value={item.chimney || item.spare.size} />
              <Fact label="Material" value={item.spare.material} />
              <Fact label="IBR" value={item.spare.ibr} />
              <Fact label="Rating" value={item.spare.rating} />
              <Fact label="Make" value={item.spare.make} />
            </div>
            {item.fuels.length > 0 && <div className="flex flex-wrap gap-1.5">{item.fuels.map(f => <Badge key={f} variant="secondary">{f}</Badge>)}</div>}
            {item.build.length > 0 && <div className="flex flex-wrap gap-1.5">{item.build.map(f => <Badge key={f} variant="outline">{f}</Badge>)}</div>}
            {item.intro && <p className="text-sm leading-relaxed text-muted-foreground">{item.intro}</p>}
            {item.includes.length > 0 && (
              <div><h3 className="mb-2 text-sm font-semibold">What's included</h3>
                <ul className="flex flex-col gap-1.5">{item.includes.map((x, n) => <li key={n} className="flex gap-2 text-sm"><Check className="mt-0.5 size-4 shrink-0 text-primary" />{x}</li>)}</ul>
              </div>
            )}
            {item.excludes.length > 0 && (
              <div><h3 className="mb-2 text-sm font-semibold">Not included</h3>
                <p className="text-sm text-muted-foreground">{item.excludes.join(' · ')}</p>
              </div>
            )}
            {addOns.length > 0 && (
              <div><h3 className="mb-2 text-sm font-semibold">Often ordered with</h3>
                <ul className="flex flex-col gap-2">{addOns.map(a => (
                  <li key={a.id} className="flex items-center gap-3 rounded-lg border p-2">
                    <div className="grid size-9 shrink-0 place-items-center rounded-md bg-primary/10 text-primary"><GroupIcon name={a.icon} className="size-4" /></div>
                    <div className="min-w-0 flex-1"><div className="truncate text-sm font-medium">{a.groupLabel}</div><div className="truncate text-xs text-muted-foreground">{[a.title, a.model].filter(Boolean).join(' · ')}</div></div>
                    <Button size="sm" variant={has(a.id) ? 'secondary' : 'outline'} onClick={() => add(a)} disabled={has(a.id)}>{has(a.id) ? 'Added' : 'Add'}</Button>
                  </li>))}
                </ul>
              </div>
            )}
            <p className="text-xs text-muted-foreground">Final scope, price and delivery are confirmed in our quotation.</p>
            <div className="sticky bottom-0 -mx-6 border-t bg-background px-6 py-3"><AddButton item={item} size="default" /></div>
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}
