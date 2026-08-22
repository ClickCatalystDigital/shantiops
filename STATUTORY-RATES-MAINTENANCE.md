# Keeping GST/TDS/PF/ESI rates current

## The infra already exists — don't rebuild it

The app already stores statutory rates as **editable DB data with effective-date ranges**, not hardcoded constants:

| Table | API | Covers |
|---|---|---|
| `gst_rates` | [app/api/gst-rates/route.js](app/api/gst-rates/route.js) | HSN code → GST % (`effective_from`/`effective_to`) |
| `vendor_tds_rates` | [app/api/vendor-tds-rates/route.js](app/api/vendor-tds-rates/route.js) | TDS section → rate % + threshold |
| `income_tax_slabs` | [app/api/income-tax-slabs/route.js](app/api/income-tax-slabs/route.js) | Salary TDS slabs |
| `professional_tax_slabs` | `app/api/professional-tax-slabs/route.js` | State PT slabs |
| `statutory_rates` | [app/api/statutory-rates/route.js](app/api/statutory-rates/route.js) | Single-row PF/ESI %, wage ceilings, OT multiplier |

Rows are add-only with `effective_from`/`effective_to`, so a rate change is a new row, not an edit — old transactions keep computing against the rate that was live at the time. This is the right shape; there is no code gap. What's missing is **current data in the rows**, and a **recurring process** to update it. That's a compliance/ops task, not an engineering one.

## What "current" means right now (Aug 2026) — verify before entering

- **GST**: 3 core slabs since the Sep 2025 "GST 2.0" reform — **0%, 5%, 18%**, plus a **40%** slab for luxury/sin goods (tobacco, pan masala, select luxury items). The old 12% and 28% slabs are mostly gone; items moved to 5%/18%/18% respectively. You need the **item-wise HSN list** for your actual products — the slab names alone aren't enough to fill `gst_rates`.
- **TDS**: Section 194C (contractors) 1%/2%, 194I (rent) 10%/2%, new 194T (partner payments >₹20,000) 10%. Note **FY 2026-27 is the first year under the new Income Tax Act 2025** — old sections 192–196D were renumbered to consolidated Sections 392/393. Check whether your `vendor_tds_rates.section` values need remapping.
- **PF/ESI**: rates haven't moved in recent cycles (PF 12%/12%, ESI 0.75%/3.25%) but wage ceilings and thresholds do get revised — verify against current EPFO/ESIC circulars, don't assume.

I pulled these from web search, not a government API — treat them as a starting point to verify against a CA or the official portals (gst.gov.in, incometax.gov.in, epfindia.gov.in, esic.gov.in) before keying them into production, not as filed truth.

## The actual gap: a recurring update process

Nothing in the codebase watches for rate changes — GST/TDS/PF/ESI rules change by government notification, not on a schedule you can poll reliably. Cheapest infra that closes this:

1. **Owner**: whoever in Accounts/HR already has `accounts.gst_rate.write` / `accounts.tds_rate.write` / `hr.statutory.write` — the write gate already exists, just assign a human to use it.
2. **Cadence**: check after each Union Budget (Feb) and GST Council meeting (irregular, ~quarterly) — those are the two events that actually move these numbers. A recurring reminder tied to those events beats a blind monthly cron.
3. **Source of truth**: your CA/compliance consultant's notification, cross-checked against gst.gov.in / incometax.gov.in circulars — not a web search summary.
4. **Action**: insert a new row with `effective_from` = notification date, leave the prior row's `effective_to` set (or the app's existing lookup logic already picks the latest applicable row — check `getGstRates`/`getVendorTdsRates` in [lib/data.js](lib/data.js) for how "current" is resolved).

Skipped: an auto-fetch job scraping gst.gov.in — no stable public API for it, rates change a handful of times a year, and getting it subtly wrong (wrong HSN mapping, missed notification) is worse than a human doing it 3-4 times a year. Add automation only if you find a paid rate-feed API (e.g. ClearTax/Zoho compliance API) worth the subscription.
