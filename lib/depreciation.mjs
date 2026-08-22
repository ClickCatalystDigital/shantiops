// lib/depreciation.mjs — Schedule II (Companies Act) monthly depreciation, SLM and WDV. Dependency-
// free, same precedent as lib/gst-calc.mjs: real calc logic lives here with its own selfcheck, never
// inline in a route.
// ponytail: monthly granularity only, no day-level proration for part-month asset purchases —
// Schedule II allows day-proration but it's a small correction most SMEs round past; add if an
// auditor actually asks for it.

function round2(n) { return Math.round((n + Number.EPSILON) * 100) / 100; }

// SLM: (cost - salvage) spread evenly over the asset's useful life, in equal monthly instalments.
function slmMonthly({ cost, salvageValue, usefulLifeYears }) {
  return round2((cost - salvageValue) / (usefulLifeYears * 12));
}

// WDV: the rate that reduces `cost` to `salvageValue` over `usefulLifeYears`, applied monthly to the
// asset's current book value (cost - accumulated so far) — same formula the Companies Act's own WDV
// method note derives (rate = 1 - (salvage/cost)^(1/life)).
function wdvMonthly({ cost, salvageValue, usefulLifeYears, accumulatedDepreciation }) {
  const bookValue = cost - accumulatedDepreciation;
  if (bookValue <= salvageValue) return 0;
  const rate = 1 - Math.pow((salvageValue || 0.01) / cost, 1 / usefulLifeYears);
  return round2(bookValue * rate / 12);
}

// One asset's depreciation for one month, capped so accumulated never exceeds (cost - salvage) —
// an asset never depreciates below its salvage value regardless of method or rounding drift.
export function monthlyDepreciation({ cost, salvageValue = 0, usefulLifeYears, method, accumulatedDepreciation = 0 }) {
  if (usefulLifeYears <= 0 || cost <= salvageValue) return 0;
  const remaining = round2(cost - salvageValue - accumulatedDepreciation);
  if (remaining <= 0) return 0;
  const raw = method === 'WDV'
    ? wdvMonthly({ cost, salvageValue, usefulLifeYears, accumulatedDepreciation })
    : slmMonthly({ cost, salvageValue, usefulLifeYears });
  return Math.min(raw, remaining);
}
