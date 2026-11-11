// Parity self-check for the mechanism ports (market-intel plan D3). Fails if a vectors copy differs from its pin, or any port is
// outside tolerance on any shared reference vector. Needs no database. Run by `npm run check` (scripts/check-all.mjs).
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { steelTiming } from './mechanisms/steel-timing.mjs';
import { cashGapFinancing } from './mechanisms/cash-gap-financing.mjs';

const TOLERANCE = 0.01; // the canonical specs' tolerance.absolute
const PORTS = { 'steel_timing@1': steelTiming, 'cash_gap_financing@1': cashGapFinancing };
const here = (p) => new URL(p, import.meta.url);
const pins = JSON.parse(readFileSync(here('./mechanisms/PINS.json'), 'utf8'));
let failed = 0;
const fail = (m) => { failed += 1; console.log('FAIL ' + m); };

for (const [ref, port] of Object.entries(PORTS)) {
  const bytes = readFileSync(here(`./mechanisms/vectors/${ref}.json`));
  const sha = createHash('sha256').update(bytes).digest('hex');
  if (pins[ref] !== sha) { fail(`${ref}: vectors copy sha256 ${sha} differs from the pin ${pins[ref]}; copy the canonical file and update PINS.json`); continue; }
  const doc = JSON.parse(bytes.toString('utf8'));
  if (!doc.cases.length || doc.cases.filter((c) => c.origin !== 'generated').length < 3) fail(`${ref}: needs at least 3 independently worked cases`);
  for (const c of doc.cases) {
    let got;
    try { got = port(c.inputs); } catch (e) { fail(`${ref} ${c.id}: ${e.message}`); continue; }
    for (const [k, want] of Object.entries(c.expected)) {
      if (typeof got[k] !== 'number' || Math.abs(got[k] - want) > TOLERANCE) fail(`${ref} ${c.id}: ${k} expected ${want}, port gives ${got[k]}`);
    }
  }
}
// a port must reject what the spec rejects
const mustThrow = (name, fn) => { try { fn(); fail(`${name}: should have thrown`); } catch { /* expected */ } };
mustThrow('steel_timing negative qty', () => steelTiming({ open_qty: -1, unit: 't', currency: 'XXX', quote_rate: 1, purchase_rate: 1 }));
mustThrow('steel_timing unknown input', () => steelTiming({ open_qty: 1, unit: 't', currency: 'XXX', quote_rate: 1, purchase_rate: 1, wpi: 3 }));
const base = { currency: 'XXX', order_value: 1e6, advance: 0.2, materials: 0.6, other_costs: 0.25, retention: 0, purchase_month: 2, fabrication_months: 3, collection_delay: 1, retention_delay: 6, annual_rate_pct: 12 };
mustThrow('cash_gap loss-making', () => cashGapFinancing({ ...base, materials: 0.9, other_costs: 0.3 }));
mustThrow('cash_gap steel > materials', () => cashGapFinancing({ ...base, steel: 0.7 }));
mustThrow('cash_gap fraction out of range', () => cashGapFinancing({ ...base, advance: 20 }));
mustThrow('cash_gap fractional months', () => cashGapFinancing({ ...base, purchase_month: 1.5 }));
console.log(failed ? `mechanisms parity: ${failed} failure(s)` : 'mechanisms parity: ok (2 ports, every vector within tolerance, pins match)');
process.exit(failed ? 1 : 0);
