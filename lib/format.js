// lib/format.js — pure formatters, safe to import from both server and client components.
// Market-aware (lib/market.js): India output is exactly what it always was; the US build prints $, en-US
// grouping and MM/DD/YYYY.
import { IS_US, LOCALE } from './market.js';

export function formatDate(dateStr) {
  if (!dateStr) return '—';
  if (IS_US) {
    // Stored dates are local calendar dates (and local timestamps): print the date part as written.
    const d = new Date(String(dateStr).slice(0, 10) + 'T00:00:00Z');
    if (isNaN(d)) return '—';
    return d.toLocaleDateString('en-US', { month: '2-digit', day: '2-digit', year: 'numeric', timeZone: 'UTC' });
  }
  const d = new Date(dateStr.length <= 10 ? dateStr + 'T00:00:00+05:30' : dateStr.replace(' ', 'T') + '+05:30');
  return d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'Asia/Kolkata' });
}

export function capitalize(s) {
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : s;
}

// Short money: India ₹42L / ₹4.2Cr; US $420K / $4.2M. Negative (a real margin can run negative) renders as
// -₹1.2L, sign prefixed before the symbol, not after it.
export function formatMoney(n) {
  if (!n) return '—';
  const sign = n < 0 ? '-' : '';
  const abs = Math.abs(n);
  if (IS_US) {
    if (abs >= 1e6) return `${sign}$${(abs / 1e6).toFixed(2).replace(/\.00$/, '')}M`;
    if (abs >= 1e4) return `${sign}$${(abs / 1e3).toFixed(1).replace(/\.0$/, '')}K`;
    return `${sign}$${abs.toLocaleString('en-US')}`;
  }
  if (abs >= 1e7) return `${sign}₹${(abs / 1e7).toFixed(2).replace(/\.00$/, '')}Cr`;
  if (abs >= 1e5) return `${sign}₹${(abs / 1e5).toFixed(1).replace(/\.0$/, '')}L`;
  return `${sign}₹${abs.toLocaleString('en-IN')}`;
}

// Number grouped for the market (India 12,34,567; US 1,234,567). opts: Intl.NumberFormat options.
export const formatNumber = (n, opts) => Number(n || 0).toLocaleString(LOCALE, opts);

// Full money with the symbol, e.g. ₹12,34,567.00 / $1,234,567.00. decimals: 2 by default, 0 for whole units.
export function formatAmount(n, decimals = 2) {
  const v = Number(n || 0);
  const s = Math.abs(v).toLocaleString(LOCALE, { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
  return `${v < 0 ? '-' : ''}${IS_US ? '$' : '₹'}${s}`;
}
