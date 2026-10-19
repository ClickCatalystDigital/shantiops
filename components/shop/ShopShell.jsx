'use client';
// Shop frame (SYSTEM.md §5fh): header, the quote basket (kept in sessionStorage so it survives moving
// between groups; nothing else is stored), the Request a quote dialog, and shared bits (icons, photo).
import { createContext, useContext, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { ShoppingCart, X, ImagePlus, Trash2, Loader2, Minus, Plus, CheckCircle2, ArrowLeft, Flame, Wheat, Droplet, Wind, Waves, Factory, Thermometer, ShowerHead, Recycle, Fan, Gauge, Heater, Cylinder, Tornado, Filter, Route, Cog, RotateCw, CircleDot, Spline, Grid3x3, BrickWall, Layers, Wrench, Package } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription, SheetFooter } from '@/components/ui/sheet';
import { Badge } from '@/components/ui/badge';
import LogoutButton from '@/components/LogoutButton';
import CustomerNavLinks from '@/components/CustomerNavLinks';
import { compressImage } from '@/lib/image-compress';
import { showToast } from '@/lib/client';

// Named imports only (a lucide namespace import would ship every icon).
const Icons = { Flame, Wheat, Droplet, Wind, Waves, Factory, Thermometer, ShowerHead, Recycle, Fan, Gauge, Heater, Cylinder, Tornado, Filter, Route, Cog, RotateCw, CircleDot, Spline, Grid3x3, BrickWall, Layers, Wrench, Package };
const KEY = 'sbShopBasket';
const Ctx = createContext(null);
export const useShop = () => useContext(Ctx);

export const imageUrl = key => (key ? `/api/shop/images?k=${encodeURIComponent(key)}` : null);

export function GroupIcon({ name, className = 'size-6' }) {
  const I = Icons[name] || Icons.Package;
  return <I className={className} aria-hidden="true" />;
}

// Photo when there is one, else the group's icon on a soft tile.
export function Visual({ image, icon, className = '', iconClass = 'size-10' }) {
  const src = imageUrl(image);
  return (
    <div className={`relative overflow-hidden bg-gradient-to-br from-primary/10 via-muted to-muted/40 ${className}`}>
      {src
        ? <img src={src} alt="" className="absolute inset-0 size-full object-cover" loading="lazy" />
        : <div className="absolute inset-0 grid place-items-center text-primary/70"><GroupIcon name={icon} className={iconClass} /></div>}
    </div>
  );
}

// Upload / remove a photo — only rendered for Sales and managers.
export function PhotoEdit({ productId, groupKey, hasImage, onChanged }) {
  const ref = useRef(null);
  const [busy, setBusy] = useState(false);
  const send = async (method, body) => {
    setBusy(true);
    try {
      const res = await fetch('/api/shop/images', method === 'DELETE'
        ? { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }
        : { method, body });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Could not save the photo');
      showToast(method === 'DELETE' ? 'Photo removed' : 'Photo saved');
      onChanged?.(data.image_key || null);
    } catch (e) { showToast(e.message, 'error'); }
    finally { setBusy(false); }
  };
  const pick = async e => {
    const f = e.target.files?.[0]; e.target.value = '';
    if (!f) return;
    let file;
    try { file = await compressImage(f); } catch { showToast('This file is not an image the browser can open', 'error'); return; }
    const fd = new FormData(); fd.append('file', file);
    if (productId) fd.append('product_id', productId); else fd.append('group_key', groupKey);
    send('POST', fd);
  };
  return (
    <div className="flex items-center gap-1">
      <input ref={ref} type="file" accept="image/*" className="hidden" onChange={pick} />
      <Button type="button" size="sm" variant="secondary" disabled={busy} onClick={e => { e.preventDefault(); e.stopPropagation(); ref.current?.click(); }}>
        {busy ? <Loader2 className="size-4 animate-spin" /> : <ImagePlus className="size-4" />}{hasImage ? 'Change photo' : 'Add photo'}
      </Button>
      {hasImage && (
        <Button type="button" size="icon" variant="ghost" disabled={busy} aria-label="Remove photo"
          onClick={e => { e.preventDefault(); e.stopPropagation(); send('DELETE', productId ? { product_id: productId } : { group_key: groupKey }); }}>
          <Trash2 className="size-4" />
        </Button>
      )}
    </div>
  );
}

function readBasket() {
  try { return JSON.parse(sessionStorage.getItem(KEY) || '[]'); } catch { return []; }
}

export default function ShopShell({ isCustomer, canEdit, children }) {
  const [basket, setBasket] = useState([]);
  const [open, setOpen] = useState(false);
  useEffect(() => { setBasket(readBasket()); }, []);
  useEffect(() => { try { sessionStorage.setItem(KEY, JSON.stringify(basket)); } catch {} }, [basket]);

  const api = useMemo(() => ({
    basket, canEdit, isCustomer,
    has: id => basket.some(b => b.id === id),
    add: item => setBasket(b => (b.some(x => x.id === item.id) ? b : [...b, { id: item.id, title: item.title, model: item.model, isSet: item.isSet, unit: item.unit, qty: item.isSet ? 1 : '' }])),
    remove: id => setBasket(b => b.filter(x => x.id !== id)),
    setQty: (id, qty) => setBasket(b => b.map(x => (x.id === id ? { ...x, qty } : x))),
    clear: () => setBasket([]),
    openQuote: () => setOpen(true),
  }), [basket, canEdit, isCustomer]);

  return (
    <Ctx.Provider value={api}>
      <div className="min-h-screen bg-muted/30 pb-24 md:pb-10">
        {!isCustomer && (
          <div className="border-b bg-amber-100 px-4 py-1.5 text-center text-xs text-amber-900">
            Shop preview: this is what customers see{canEdit ? '. You can add product photos here.' : '.'}
          </div>
        )}
        <header className="sticky top-0 z-30 border-b bg-background/80 backdrop-blur-md">
          <div className="container flex h-14 items-center justify-between gap-2">
            {isCustomer
              ? <CustomerNavLinks active="shop" />
              : <Link href="/shop" className="flex items-baseline gap-2 text-base font-bold tracking-tight"><span><span className="text-muted-foreground">SB</span><span className="text-primary">OPS</span></span><span className="font-medium text-muted-foreground">Shop</span></Link>}
            <div className="flex items-center gap-1">
              {isCustomer
                ? <Button asChild variant="ghost" size="sm" className="hidden sm:inline-flex"><Link href="/help">Help</Link></Button>
                : <Button asChild variant="ghost" size="sm"><Link href="/"><ArrowLeft className="size-4" />Back to app</Link></Button>}
              <Button variant={basket.length ? 'default' : 'outline'} size="sm" onClick={() => setOpen(true)} className="relative">
                <ShoppingCart className="size-4" /><span className="hidden sm:inline">Quote request</span>
                {basket.length > 0 && <Badge variant="secondary" className="ml-0.5 h-5 min-w-5 rounded-full px-1.5 tabular-nums">{basket.length}</Badge>}
              </Button>
              {isCustomer && <LogoutButton />}
            </div>
          </div>
        </header>
        {children}
        {basket.length > 0 && (
          <div className="fixed inset-x-3 bottom-3 z-40 md:hidden" style={{ marginBottom: 'env(safe-area-inset-bottom)' }}>
            <Button className="h-12 w-full rounded-full shadow-lg" onClick={() => setOpen(true)}>
              <ShoppingCart className="size-4" />Request a quote · {basket.length} item{basket.length > 1 ? 's' : ''}
            </Button>
          </div>
        )}
        <QuoteSheet open={open} onOpenChange={setOpen} />
      </div>
    </Ctx.Provider>
  );
}

function QuoteSheet({ open, onOpenChange }) {
  const { basket, remove, setQty, clear, isCustomer } = useShop();
  const [custom, setCustom] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  useEffect(() => { if (open) setDone(false); }, [open]);
  const step = (b, d) => setQty(b.id, String(Math.max(1, (Number(b.qty) || 0) + d)));

  const submit = async () => {
    setBusy(true);
    try {
      const res = await fetch('/api/shop/quote-request', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ items: basket.map(b => ({ product_id: b.id, qty: b.qty })), custom, note }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Could not send your request');
      clear(); setCustom(''); setNote(''); setDone(true);
    } catch (e) { showToast(e.message, 'error'); }
    finally { setBusy(false); }
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="flex w-full flex-col gap-0 p-0 data-[side=right]:sm:max-w-md">
        <SheetHeader className="border-b p-5">
          <SheetTitle>{done ? 'Request sent' : 'Your quote request'}</SheetTitle>
          <SheetDescription>{done ? 'Our sales team will reply with prices, delivery time and the technical offer.' : 'No prices online. Tell us what you need and we send a tailored quotation.'}</SheetDescription>
        </SheetHeader>
        {done ? (
          <div className="flex flex-1 flex-col items-center justify-center gap-3 p-8 text-center">
            <CheckCircle2 className="size-14 text-primary" />
            <p className="font-medium">Thank you, we have your request.</p>
            <p className="text-sm text-muted-foreground">You can follow your orders from My orders.</p>
          </div>
        ) : (
          <div className="flex flex-1 flex-col gap-5 overflow-y-auto p-5">
            {basket.length === 0
              ? <div className="rounded-xl border border-dashed p-6 text-center text-sm text-muted-foreground">Nothing added yet. Browse the range and press <span className="font-medium text-foreground">Add to quote</span>, or describe what you need below.</div>
              : <ul className="flex flex-col gap-2">
                  {basket.map(b => (
                    <li key={b.id} className="flex items-center gap-3 rounded-xl border bg-card p-3">
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-sm font-medium">{b.title}</div>
                        {b.model && <div className="truncate font-mono text-xs text-muted-foreground">{b.model}</div>}
                      </div>
                      <div className="flex items-center rounded-lg border">
                        <Button size="icon" variant="ghost" className="size-8" aria-label="Less" onClick={() => step(b, -1)}><Minus className="size-3.5" /></Button>
                        <Input type="number" min="1" inputMode="numeric" aria-label="Quantity" placeholder="Qty"
                          className="h-8 w-12 border-0 px-0 text-center shadow-none focus-visible:ring-0 [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none"
                          value={b.qty ?? ''} onChange={e => setQty(b.id, e.target.value)} />
                        <Button size="icon" variant="ghost" className="size-8" aria-label="More" onClick={() => step(b, 1)}><Plus className="size-3.5" /></Button>
                      </div>
                      {b.unit && <span className="w-8 text-xs text-muted-foreground">{b.unit}</span>}
                      <Button size="icon" variant="ghost" className="size-8 text-muted-foreground" aria-label="Remove" onClick={() => remove(b.id)}><X className="size-4" /></Button>
                    </li>
                  ))}
                </ul>}
            <label className="flex flex-col gap-1.5 text-sm">
              <span className="font-medium">Need something else or a custom size?</span>
              <Textarea rows={3} value={custom} onChange={e => setCustom(e.target.value)} placeholder="e.g. 3 TPH steam at 17 kg/cm², rice husk fired" />
            </label>
            <label className="flex flex-col gap-1.5 text-sm">
              <span className="font-medium">Note for our team <span className="font-normal text-muted-foreground">(optional)</span></span>
              <Textarea rows={2} value={note} onChange={e => setNote(e.target.value)} placeholder="Site location, timeline, contact person" />
            </label>
          </div>
        )}
        <SheetFooter className="border-t p-5">
          {done
            ? <Button onClick={() => onOpenChange(false)}>Continue browsing</Button>
            : isCustomer
              ? <Button size="lg" onClick={submit} disabled={busy || (!basket.length && !custom.trim())}>{busy && <Loader2 className="size-4 animate-spin" />}Send request</Button>
              : <Button size="lg" disabled>Only customers can send requests</Button>}
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}
