'use client';
// Shop landing (SYSTEM.md §5fh): search across everything, "Find the right boiler", and every group
// by section. All data comes from the server already cleaned; no prices.
import { useMemo, useState } from 'react';
import Link from 'next/link';
import { Search, Sparkles, ChevronRight, ArrowLeft } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Visual, PhotoEdit, useShop } from './ShopShell';

export default function ShopHome({ sections, index, finderPool, initialSection }) {
  const { canEdit } = useShop();
  const [q, setQ] = useState('');
  const [finder, setFinder] = useState(false);
  const [section, setSection] = useState(sections.some(s => s.key === initialSection) ? initialSection : 'all');
  const [images, setImages] = useState({}); // group photo changes made on this page
  const hits = useMemo(() => {
    const words = q.toLowerCase().split(/\s+/).filter(Boolean);
    if (!words.length) return [];
    return index.filter(i => words.every(w => i.s.includes(w))).slice(0, 40);
  }, [q, index]);
  const pickSection = k => {
    setSection(k);
    const u = new URL(window.location.href);
    if (k === 'all') u.searchParams.delete('section'); else u.searchParams.set('section', k);
    window.history.replaceState(null, '', u);
  };
  const shownSections = section === 'all' ? sections : sections.filter(s => s.key === section);
  const total = sections.reduce((n, s) => n + s.groups.length, 0);

  return (
    <main className="flex flex-col">
      <section className="relative z-[25] border-b bg-gradient-to-br from-primary/[0.12] via-background to-background">
        <div aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden"><div className="absolute -right-24 -top-24 size-96 rounded-full bg-primary/10 blur-3xl" /></div>
        <div className="container relative flex flex-col gap-6 py-10 sm:py-14">
          <Badge variant="outline" className="w-fit bg-background/60 font-normal">Steam · Thermal · Heat recovery · Spares · Service</Badge>
          <div className="flex max-w-3xl flex-col gap-3">
            <h1 className="text-3xl font-semibold tracking-tight text-balance sm:text-5xl">Boilers, heaters and everything around them</h1>
            <p className="text-base text-muted-foreground sm:text-lg">Pick a family, compare models and add them to one quote request. Our sales team replies with prices, delivery and the technical offer.</p>
          </div>
          <div className="flex max-w-3xl flex-col gap-3 sm:flex-row">
            <div className="relative flex-1">
              <Search className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input className="h-12 rounded-xl bg-background pl-10 text-base shadow-sm" placeholder="Search: 2 TPH, safety valve 40 NB, chimney…" value={q} onChange={e => setQ(e.target.value)} aria-label="Search products" />
              {q.trim() && (
                <div className="absolute inset-x-0 top-full z-20 mt-2 max-h-96 overflow-y-auto rounded-xl border bg-popover shadow-xl">
                  {hits.length === 0
                    ? <p className="p-4 text-sm text-muted-foreground">Nothing matches. Try fewer words, or describe it in a quote request.</p>
                    : <ul className="divide-y">{hits.map(h => (
                      <li key={h.id}><Link href={`/shop/${h.g}?item=${h.id}`} className="flex items-center gap-3 px-4 py-2.5 hover:bg-muted/60">
                        <div className="min-w-0 flex-1">
                          <div className="truncate text-sm font-medium">{h.t}</div>
                          <div className="truncate text-xs text-muted-foreground">{[h.m, h.gl].filter(Boolean).join(' · ')}</div>
                        </div>
                        <ChevronRight className="size-4 text-muted-foreground" />
                      </Link></li>))}
                    </ul>}
                </div>
              )}
            </div>
            <Button size="lg" className="h-12 rounded-xl" onClick={() => setFinder(true)}><Sparkles className="size-4" />Find the right boiler</Button>
          </div>
        </div>
      </section>

      <div className="sticky top-14 z-20 border-b bg-background/85 backdrop-blur-md">
        <div className="container flex gap-2 overflow-x-auto py-3 [scrollbar-width:none]">
          {[{ key: 'all', label: 'All families', n: total }, ...sections.map(s => ({ key: s.key, label: s.label, n: s.groups.length }))].map(t => (
            <button key={t.key} type="button" onClick={() => pickSection(t.key)} aria-pressed={section === t.key}
              className={`flex shrink-0 items-center gap-1.5 rounded-full border px-3.5 py-1.5 text-sm transition ${section === t.key ? 'border-primary bg-primary text-primary-foreground shadow-sm' : 'bg-background hover:border-primary/40 hover:bg-muted/50'}`}>
              {t.label}<span className={`text-xs tabular-nums ${section === t.key ? 'opacity-80' : 'text-muted-foreground'}`}>{t.n}</span>
            </button>
          ))}
        </div>
      </div>

      <div className="container flex flex-col gap-12 py-10">
        {shownSections.map(s => (
          <section key={s.key} className="flex flex-col gap-5">
            <div className="flex items-end justify-between gap-4">
              <div>
                <h2 className="text-2xl font-semibold tracking-tight">{s.label}</h2>
                <p className="mt-1 text-sm text-muted-foreground">{s.blurb}</p>
              </div>
              <span className="hidden shrink-0 text-sm text-muted-foreground sm:block">{s.groups.length} famil{s.groups.length === 1 ? 'y' : 'ies'}</span>
            </div>
            <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
              {s.groups.map(g => {
                const image = g.key in images ? images[g.key] : g.image;
                return (
                  <Card key={g.key} className="group gap-0 overflow-hidden p-0 transition hover:-translate-y-0.5 hover:shadow-lg hover:ring-primary/30">
                    <Link href={`/shop/${g.key}`} className="flex flex-1 flex-col">
                      <Visual image={image} icon={g.icon} className="aspect-[16/10]" iconClass="size-12 transition duration-300 group-hover:scale-110" />
                      <div className="flex flex-1 flex-col gap-2 p-5">
                        <div className="text-base font-semibold leading-snug">{g.label}</div>
                        <p className="line-clamp-2 text-sm text-muted-foreground">{g.blurb}</p>
                        {g.fuels.length > 0 && (
                          <div className="flex flex-wrap gap-1 pt-1">{g.fuels.slice(0, 3).map(f => <Badge key={f} variant="secondary" className="font-normal">{f}</Badge>)}{g.fuels.length > 3 && <Badge variant="outline" className="font-normal">+{g.fuels.length - 3}</Badge>}</div>
                        )}
                        <div className="mt-auto flex items-center justify-between border-t pt-3 text-sm">
                          <span className="text-muted-foreground">{g.count} {g.kind === 'services' ? 'services' : g.count === 1 ? 'model' : 'models'}{g.range ? ` · ${g.range}` : ''}</span>
                          <ChevronRight className="size-4 text-primary transition group-hover:translate-x-0.5" />
                        </div>
                      </div>
                    </Link>
                    {/* outside the link: a file picker opened inside an <a> would also follow it */}
                    {canEdit && <div className="px-5 pb-4"><PhotoEdit groupKey={g.key} hasImage={!!image} onChanged={k => setImages(m => ({ ...m, [g.key]: k }))} /></div>}
                  </Card>
                );
              })}
            </div>
          </section>
        ))}
      </div>
      <NeedFinder open={finder} onOpenChange={setFinder} pool={finderPool} />
    </main>
  );
}

// "Find the right boiler": what heat → fuel → size → pressure, each step offering only what exists.
function NeedFinder({ open, onOpenChange, pool }) {
  const [pick, setPick] = useState({});
  const steps = [
    { key: 'use', label: 'What do you need?', opts: i => [i.use] },
    { key: 'fuel', label: 'Which fuel will you use?', opts: i => i.fuels },
    { key: 'cap', label: 'How much output?', opts: i => (i.cap ? [i.cap] : []), sort: (a, b) => a.v - b.v },
    { key: 'pres', label: 'Working pressure', opts: i => (i.pres ? [i.pres] : []), sort: (a, b) => a.v - b.v, skipIf: p => p.use === 'Thermal fluid / hot water' },
  ];
  const keyOf = o => (typeof o === 'string' ? o : o.l);
  const matches = (i, upTo) => steps.slice(0, upTo).every(s => !pick[s.key] || s.opts(i).some(o => keyOf(o) === pick[s.key]));
  const answered = s => s.key in pick || (s.skipIf && s.skipIf(pick)); // null = "Not sure"
  const stepIndex = steps.findIndex(s => !answered(s));
  const done = stepIndex === -1;
  const step = steps[stepIndex];

  let results = [];
  if (done || (step && options(step).length === 0)) results = pool.filter(i => matches(i, steps.length));
  function options(s) {
    const m = new Map();
    for (const i of pool.filter(x => matches(x, steps.indexOf(s)))) for (const o of s.opts(i)) m.set(keyOf(o), o);
    const list = [...m.values()];
    return s.sort ? list.sort(s.sort) : list.sort((a, b) => keyOf(a).localeCompare(keyOf(b)));
  }
  // nothing at that exact size: the nearest larger size with the same use/fuel
  let nearest = [];
  if (done && !results.length && pick.cap) {
    const capV = pool.find(i => i.cap?.l === pick.cap)?.cap.v;
    const bigger = pool.filter(i => matches(i, 2) && i.cap && i.cap.v > capV).sort((a, b) => a.cap.v - b.cap.v);
    nearest = bigger.filter(i => i.cap.v === bigger[0]?.cap.v);
  }
  const back = () => { const k = [...steps].reverse().find(s => s.key in pick); if (k) setPick(p => { const n = { ...p }; delete n[k.key]; return n; }); };

  return (
    <Dialog open={open} onOpenChange={v => { onOpenChange(v); if (!v) setPick({}); }}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Find the right boiler</DialogTitle>
          <DialogDescription>Answer a few questions; we only show models we actually make.</DialogDescription>
        </DialogHeader>
        {Object.keys(pick).length > 0 && (
          <div className="flex flex-wrap items-center gap-1.5">
            <Button size="sm" variant="ghost" onClick={back}><ArrowLeft className="size-4" />Back</Button>
            {steps.filter(s => pick[s.key]).map(s => <Badge key={s.key} variant="secondary">{pick[s.key]}</Badge>)}
          </div>
        )}
        {step && !done && options(step).length > 0 && (
          <div className="flex flex-col gap-3">
            <div className="font-medium">{step.label}</div>
            <div className="flex flex-wrap gap-2">
              {options(step).map(o => (
                <Button key={keyOf(o)} variant="outline" className="h-auto py-2" onClick={() => setPick(p => ({ ...p, [step.key]: keyOf(o) }))}>{keyOf(o)}</Button>
              ))}
              {step.key !== 'use' && <Button variant="ghost" className="h-auto py-2 text-muted-foreground" onClick={() => setPick(p => ({ ...p, [step.key]: null }))}>Not sure</Button>}
            </div>
          </div>
        )}
        {(done || results.length > 0) && (
          <div className="flex max-h-[50vh] flex-col gap-2 overflow-y-auto">
            {results.length > 0 && <div className="text-sm text-muted-foreground">{results.length} matching model{results.length > 1 ? 's' : ''}</div>}
            {!results.length && nearest.length > 0 && <div className="text-sm text-muted-foreground">No model at exactly that size. The nearest larger:</div>}
            {[...results, ...nearest].slice(0, 30).map(i => (
              <Link key={i.id} href={`/shop/${i.g}?item=${i.id}`} onClick={() => onOpenChange(false)} className="flex items-center gap-3 rounded-lg border px-3 py-2 hover:bg-muted/50">
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-medium">{i.t}{i.series ? ` · ${i.series}` : ''}</div>
                  <div className="truncate text-xs text-muted-foreground">{[i.m, i.pres?.l, i.fuels.slice(0, 3).join(', ')].filter(Boolean).join(' · ')}</div>
                </div>
                <ChevronRight className="size-4 text-muted-foreground" />
              </Link>
            ))}
            {!results.length && !nearest.length && <p className="text-sm text-muted-foreground">No standard model fits. Use Request a quote and describe what you need: we design to order.</p>}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
