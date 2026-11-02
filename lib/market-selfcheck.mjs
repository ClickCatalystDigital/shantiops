// lib/market-selfcheck.mjs — the market profile (lib/market.js) and everything routed through it.
// India (MARKET unset) must print exactly what it always did; the US build ($, MM/DD/YYYY, calendar-year
// numbers, one sales-tax amount) is checked by re-running this file with MARKET=NA.
import { spawnSync } from 'node:child_process';
import { MARKET } from './market.js';
import { formatMoney, formatDate, formatAmount } from './format.js';
import { financialYear, gstSplit, docNo } from './gst-calc.mjs';
import { computeSaleOrderTotals } from './sale-order-calc.mjs';
import { currentFyBounds } from './date.js';
import { toImperial, fromImperial, unitLabel, imperialText } from './units.mjs';

const eq = (a, b, m) => { if (a !== b) throw new Error(`${m}: got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`); };

if (MARKET === 'IN') {
  eq(formatMoney(4200000), '₹42L', 'IN lakh'); eq(formatMoney(42000000), '₹4.20Cr', 'IN crore'); eq(formatMoney(-120000), '-₹1.2L', 'IN negative');
  eq(formatMoney(98765), '₹98,765', 'IN small'); eq(formatMoney(0), '—', 'zero');
  eq(formatDate('2026-12-31'), '31 Dec 2026', 'IN date');
  eq(formatAmount(1234567.5), '₹12,34,567.50', 'IN amount');
  eq(financialYear('2026-04-01'), '2026-27', 'IN FY'); eq(financialYear('2027-03-31'), '2026-27', 'IN FY end');
  eq(docNo('AB', 1, '2026-27'), 'AB/1/2026-27', 'IN doc no');
  const s = gstSplit({ taxableAmount: 1000, ratePct: 18, companyStateCode: '27', customerStateCode: '27' });
  eq(s.cgst + s.sgst, 180, 'IN intra'); eq(gstSplit({ taxableAmount: 1000, ratePct: 18, companyStateCode: '27', customerStateCode: '24' }).igst, 180, 'IN IGST');
  eq(computeSaleOrderTotals({ items: [{ amount: 1000, item_tax_pct: 18 }], companyStateCode: '27', customerStateCode: '24' }).total, 1180, 'IN total');
  eq(currentFyBounds().from.slice(5), '04-01', 'IN FY bounds');
  // Same check under the US profile, in a fresh process (the market is read once at import).
  const r = spawnSync(process.execPath, [new URL(import.meta.url).pathname], { env: { ...process.env, MARKET: 'NA', NEXT_PUBLIC_MARKET: 'NA' }, encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`US profile:\n${r.stdout}${r.stderr}`);
  console.log('market ok (IN + NA)');
} else {
  eq(formatMoney(4200000), '$4.20M', 'US million'); eq(formatMoney(420000), '$420K', 'US thousand'); eq(formatMoney(-12500), '-$12.5K', 'US negative');
  eq(formatMoney(9876), '$9,876', 'US small');
  eq(formatDate('2026-12-31'), '12/31/2026', 'US date'); eq(formatDate('2026-12-31 23:10:00'), '12/31/2026', 'US timestamp');
  eq(formatAmount(1234567.5), '$1,234,567.50', 'US amount');
  eq(financialYear('2026-04-01'), '2026', 'US FY = calendar year'); eq(financialYear('2026-01-05'), '2026', 'US FY Jan');
  eq(docNo('AB', 1, '2026'), 'AB-1-2026', 'US doc no');
  const s = gstSplit({ taxableAmount: 1000, ratePct: 7.25, companyStateCode: 'OH', customerStateCode: 'MI' });
  eq(s.igst, 0, 'US no IGST fallthrough'); eq(s.taxAmount, 72.5, 'US sales tax');
  const t = computeSaleOrderTotals({ items: [{ amount: 1000, item_tax_pct: 7.25 }, { amount: 500, item_tax_pct: 0 }], freight: 100 });
  eq(t.taxAmount, 72.5, 'US order tax'); eq(t.total, 1672.5, 'US order total'); eq(t.cgst + t.sgst + t.igst, 0, 'US no split');
  eq(currentFyBounds().from.slice(5), '01-01', 'US FY bounds');
  // Units: stored metric, shown imperial.
  eq(toImperial(10.54, 'kg/cm2').toFixed(0), '150', 'pressure psi'); eq(unitLabel('kg/cm2'), 'psi', 'psi label');
  eq(toImperial(185, 'C').toFixed(0), '365', '°F'); eq(toImperial(25.4, 'mm').toFixed(3), '1.000', 'inch');
  eq(Math.round(fromImperial(150, 'kg/cm2') * 100) / 100, 10.55, 'psi back to kg/cm2');
  eq(imperialText('6000×1500×10 mm · 706.5 kg'), '236.22×59.06×0.394 in · 1,557.6 lb', 'imperial screen text');
  eq(imperialText('10.54 kg/cm² at 185 °C'), '150 psi at 365 °F', 'imperial pressure/temp text');
  console.log('market NA ok');
}
