'use client';
// One shop group (SYSTEM.md §5fh). Equipment = cards with filters; items in the group that are sold
// by the piece show below as "Parts & accessories". Spares = a compact table. Services = a list.
// Clicking anything opens the detail sheet (deep link: ?item=<id>).
import { useMemo, useState, useEffect } from 'react';
import Link from 'next/link';
import { ChevronRight, Check, Plus, Search, SlidersHorizontal, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from '@/components/ui/sheet';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Card } from '@/components/ui/card';
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

// Tick-box list (styled here: the shared Checkbox's data-checked styling doesn't fire with this radix).
function FilterPanel({ fs, sel, toggle, clear, active }) {
  return (
    <div className="flex flex-col gap-5">
      <div className="flex items-center justify-between">
        <span className="text-sm font-semibold">Filters</span>
        {active > 0 && <button type="button" onClick={clear} className="text-xs text-primary hover:underline">Clear all</button>}
      </div>
      {fs.length === 0 && <p className="text-xs text-muted-foreground">No filters for this family.</p>}
      {fs.map(f => (
        <fieldset key={f.label} className="flex flex-col gap-1">
          <legend className="mb-1.5 text-xs font-medium uppercase tracking-wide text-muted-foreground">{f.label}</legend>
          <div className="flex max-h-56 flex-col overflow-y-auto">
            {f.opts.map(o => {
              const on = (sel[f.label] || []).includes(o);
              return (
                <label key={o} className="flex cursor-pointer items-center gap-2.5 rounded-md px-1.5 py-1 text-sm hover:bg-muted/60">
                  <input type="checkbox" checked={on} onChange={() => toggle(f.label, o)} className="size-4 accent-[var(--primary)]" />
                  <span className="flex-1 truncate">{o}</span>
                  <span className="text-xs tabular-nums text-muted-foreground">{f.counts.get(o)}</span>
                </label>
              );
            })}
          </div>
        </fieldset>
      ))}
    </div>
  );
}

const SORTS = {
  out_asc: ['Output: small to large', (a, b) => (a.capacity?.value ?? 1e9) - (b.capacity?.value ?? 1e9) || a.name.localeCompare(b.name)],
  out_desc: ['Output: large to small', (a, b) => (b.capacity?.value ?? -1) - (a.capacity?.value ?? -1) || a.name.localeCompare(b.name)],
  name: ['Name', (a, b) => a.title.localeCompare(b.title)],
};

export default function ShopGroup({ group, section, items, siblings, addOns, initialItem }) {
  const { canEdit } = useShop();
  const [images, setImages] = useState({}); // photo changes made here, by product id / 'group'
  const [sel, setSel] = useState({}); // facet label -> picked values (any of them matches)
  const [q, setQ] = useState('');
  const [sort, setSort] = useState(group.kind === 'equipment' ? 'out_asc' : 'name');
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [openId, setOpenId] = useState(initialItem || null);
  useEffect(() => { // keep ?item= in the address so a sheet can be shared or reloaded
    const u = new URL(window.location.href);
    if (openId) u.searchParams.set('item', openId); else u.searchParams.delete('item');
    window.history.replaceState(null, '', u);
  }, [openId]);

  const imageOf = i => (i.id in images ? images[i.id] : i.image_key);
  const groupImage = 'group' in images ? images.group : group.image;
  const main = useMemo(() => (group.kind === 'equipment' ? items.filter(i => i.isSet) : items), [items, group.kind]);
  const parts = group.kind === 'equipment' ? items.filter(i => !i.isSet) : [];
  const fs = useMemo(() => facets(main, group.kind).map(f => {
    const counts = new Map();
    for (const i of main) for (const v of [].concat(f.get(i) || [])) counts.set(v, (counts.get(v) || 0) + 1);
    return { ...f, counts };
  }), [main, group.kind]);
  const shown = useMemo(() => {
    const words = q.toLowerCase().split(/\s+/).filter(Boolean);
    return main.filter(i => fs.every(f => !sel[f.label]?.length || [].concat(f.get(i) || []).some(v => sel[f.label].includes(v)))
      && words.every(w => `${i.title} ${i.name} ${i.model || ''}`.toLowerCase().includes(w)))
      .sort(SORTS[sort][1]);
  }, [main, fs, sel, q, sort]);
  const open = items.find(i => i.id === Number(openId)) || null;
  const toggle = (label, v) => setSel(s => { const cur = s[label] || []; return { ...s, [label]: cur.includes(v) ? cur.filter(x => x !== v) : [...cur, v] }; });
  const chips = Object.entries(sel).flatMap(([label, vs]) => vs.map(v => ({ label, v })));
  const clear = () => { setSel({}); setQ(''); };
  const panel = <FilterPanel fs={fs} sel={sel} toggle={toggle} clear={clear} active={chips.length} />;

  return (
    <main className="flex flex-col">
      <section className="border-b bg-gradient-to-br from-primary/[0.08] via-background to-background">
        <div className="container flex flex-col gap-5 py-6 sm:py-8">
          <nav className="flex items-center gap-1 text-sm text-muted-foreground">
            <Link href="/shop" className="hover:text-foreground">Shop</Link><ChevronRight className="size-4" />
            <Link href={`/shop?section=${section.key}`} className="hover:text-foreground">{section.label}</Link><ChevronRight className="size-4" />
            <span className="truncate text-foreground">{group.label}</span>
          </nav>
          <div className="flex flex-col gap-5 sm:flex-row sm:items-center">
            <Visual image={groupImage} icon={group.icon} className="aspect-[16/10] w-full rounded-2xl ring-1 ring-foreground/10 sm:w-60" iconClass="size-14" />
            <div className="flex flex-1 flex-col gap-2">
              <h1 className="text-3xl font-semibold tracking-tight">{group.label}</h1>
              <p className="max-w-2xl text-muted-foreground">{group.blurb}</p>
              <p className="text-sm text-muted-foreground">{main.length} {group.kind === 'services' ? 'services' : main.length === 1 ? 'model' : 'models'}{parts.length ? ` · ${parts.length} parts & accessories` : ''}</p>
              {canEdit && <div className="pt-1"><PhotoEdit groupKey={group.key} hasImage={!!groupImage} onChanged={k => setImages(m => ({ ...m, group: k }))} /></div>}
            </div>
          </div>
          {siblings.length > 1 && (
            <div className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1 [scrollbar-width:none]">
              {siblings.map(g => (
                <Link key={g.key} href={`/shop/${g.key}`} aria-current={g.key === group.key ? 'page' : undefined}
                  className={`flex shrink-0 items-center gap-2 rounded-full border px-3.5 py-1.5 text-sm transition ${g.key === group.key ? 'border-primary bg-primary text-primary-foreground shadow-sm' : 'bg-background hover:border-primary/40 hover:bg-muted/50'}`}>
                  <GroupIcon name={g.icon} className="size-4" />{g.label}
                  <span className={`text-xs tabular-nums ${g.key === group.key ? 'opacity-80' : 'text-muted-foreground'}`}>{g.count}</span>
                </Link>
              ))}
            </div>
          )}
        </div>
      </section>

      <div className="container grid gap-8 py-8 lg:grid-cols-[240px_1fr]">
        {fs.length > 0 && <aside className="hidden lg:block"><div className="sticky top-20 rounded-xl bg-card p-4 ring-1 ring-foreground/10">{panel}</div></aside>}
        <div className={`flex min-w-0 flex-col gap-5 ${fs.length ? '' : 'lg:col-span-2'}`}>
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
            <div className="relative flex-1">
              <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input className="h-10 bg-background pl-9" placeholder={`Search ${group.label.toLowerCase()}`} value={q} onChange={e => setQ(e.target.value)} />
            </div>
            <div className="flex gap-2">
              {fs.length > 0 && <Button variant="outline" className="h-10 lg:hidden" onClick={() => setFiltersOpen(true)}><SlidersHorizontal className="size-4" />Filters{chips.length ? ` (${chips.length})` : ''}</Button>}
              <Select value={sort} onValueChange={setSort}>
                <SelectTrigger className="h-10 w-full bg-background sm:w-52"><SelectValue /></SelectTrigger>
                <SelectContent>{Object.entries(SORTS).filter(([k]) => group.kind === 'equipment' || k === 'name').map(([k, [l]]) => <SelectItem key={k} value={k}>{l}</SelectItem>)}</SelectContent>
              </Select>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <span className="text-muted-foreground">{shown.length} of {main.length} shown</span>
            {chips.map(c => (
              <button key={c.label + c.v} type="button" onClick={() => toggle(c.label, c.v)} className="flex items-center gap-1 rounded-full bg-primary/10 px-2.5 py-0.5 text-xs text-primary hover:bg-primary/15">
                {c.v}<X className="size-3" />
              </button>
            ))}
            {(chips.length > 0 || q) && <button type="button" onClick={clear} className="text-xs text-muted-foreground hover:text-foreground hover:underline">Clear</button>}
          </div>

          {group.kind === 'equipment' && (
            <div className="grid gap-5 sm:grid-cols-2 xl:grid-cols-3">
              {shown.map(i => (
                <Card key={i.id} role="button" tabIndex={0} onClick={() => setOpenId(i.id)} onKeyDown={e => e.key === 'Enter' && setOpenId(i.id)}
                  className="group cursor-pointer gap-0 p-0 text-left transition hover:-translate-y-0.5 hover:shadow-lg hover:ring-primary/30">
                  <Visual image={imageOf(i) || groupImage} icon={group.icon} className="aspect-[16/10]" iconClass="size-10 transition duration-300 group-hover:scale-110" />
                  <div className="flex flex-1 flex-col gap-3 p-5">
                    <div className="min-w-0">
                      <div className="text-base font-semibold">{i.title}</div>
                      {i.model && <div className="truncate font-mono text-xs text-muted-foreground">{i.model}</div>}
                    </div>
                    {(i.pressure || i.passes || i.back || i.chimney) && (
                      <dl className="grid grid-cols-2 gap-x-3 gap-y-1.5 text-xs">
                        {i.pressure && <Spec label="Pressure" value={i.pressure.label} />}
                        {i.passes && <Spec label="Passes" value={`${i.passes}-pass`} />}
                        {i.back && <Spec label="Design" value={i.back} />}
                        {i.chimney && <Spec label="Size" value={i.chimney} />}
                      </dl>
                    )}
                    {i.fuels.length > 0 && <div className="flex flex-wrap gap-1">{i.fuels.slice(0, 4).map(f => <Badge key={f} variant="secondary" className="font-normal">{f}</Badge>)}</div>}
                    <div className="mt-auto flex items-center justify-between border-t pt-3">
                      <span className="text-sm text-primary group-hover:underline">View details</span>
                      <AddButton item={i} />
                    </div>
                  </div>
                </Card>
              ))}
            </div>
          )}

          {group.kind === 'spares' && <SpareTable rows={shown} onOpen={setOpenId} />}

          {group.kind === 'services' && (
            <ul className="flex flex-col gap-3">
              {shown.map(i => (
                <li key={i.id} role="button" tabIndex={0} onClick={() => setOpenId(i.id)} onKeyDown={e => e.key === 'Enter' && setOpenId(i.id)}
                  className="flex cursor-pointer items-center gap-4 rounded-xl bg-card p-4 ring-1 ring-foreground/10 transition hover:ring-primary/30">
                  <div className="grid size-11 shrink-0 place-items-center rounded-xl bg-primary/10 text-primary"><GroupIcon name={group.icon} className="size-5" /></div>
                  <div className="min-w-0 flex-1">
                    <div className="font-medium">{i.name}</div>
                    {i.intro && <p className="line-clamp-2 text-sm text-muted-foreground">{i.intro}</p>}
                  </div>
                  <AddButton item={i} />
                </li>
              ))}
            </ul>
          )}

          {shown.length === 0 && (
            <div className="flex flex-col items-center gap-3 rounded-xl border border-dashed py-12 text-center">
              <p className="text-sm text-muted-foreground">Nothing matches these filters.</p>
              <Button variant="outline" size="sm" onClick={clear}>Clear filters</Button>
            </div>
          )}

          {parts.length > 0 && (
            <div className="flex flex-col gap-3 pt-4">
              <h2 className="text-xl font-semibold tracking-tight">Parts & accessories</h2>
              <SpareTable rows={parts} onOpen={setOpenId} />
            </div>
          )}
        </div>
      </div>

      <Sheet open={filtersOpen} onOpenChange={setFiltersOpen}>
        <SheetContent side="left" className="w-80 overflow-y-auto p-5">
          <SheetHeader className="sr-only p-0"><SheetTitle>Filters</SheetTitle><SheetDescription>Narrow the models shown</SheetDescription></SheetHeader>
          {panel}
          <Button className="mt-6 w-full" onClick={() => setFiltersOpen(false)}>Show {shown.length} result{shown.length === 1 ? '' : 's'}</Button>
        </SheetContent>
      </Sheet>

      <ProductSheet item={open} group={group} addOns={open ? addOns[open.id] || [] : []} image={open ? imageOf(open) : null}
        groupImage={groupImage} canEdit={canEdit} onClose={() => setOpenId(null)}
        onImage={k => open && setImages(m => ({ ...m, [open.id]: k }))} />
    </main>
  );
}

function Spec({ label, value }) {
  return <div className="min-w-0"><dt className="text-muted-foreground">{label}</dt><dd className="truncate font-medium">{value}</dd></div>;
}

function SpareTable({ rows, onOpen }) {
  if (!rows.length) return null;
  return (
    <>
      <div className="hidden overflow-hidden rounded-xl bg-card ring-1 ring-foreground/10 md:block">
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
          <li key={i.id} onClick={() => onOpen(i.id)} className="flex items-center gap-3 rounded-xl bg-card p-3 ring-1 ring-foreground/10">
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
  return <div className="rounded-xl bg-muted/40 px-3 py-2.5"><div className="text-xs text-muted-foreground">{label}</div><div className="text-sm font-medium">{value}</div></div>;
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
