# Demo video: India (IBR) recording prep

Chapters per department, stitched into one long video: Sales, Design (done) → Engineering → Procurement → Stores →
QC → Production → Dispatch → Service → Accounts → customer portal. One story: the SO-6 order (Meridian Agro Foods,
MF 2000 kg/hr, 12 subsystems, 81 BOM lines). Excel/PMB import is not shown. Later videos: ASME (US), then the same
done through Ember AI chat.

Demo: boiler-erp.ahromlabs.com, master copy `sb-demo-golden` (owner-pass browser writes it; nightly reset copies it
to the live demo). Secrets: `.demo-secrets`. Back up golden (`turso db shell <golden> .dump`) before any write.

## Work list (India only)

1. **Project number.** Rename project 8 `SO-6` → `AB-1006` (Edit Project or SQL; links are by id). Set
   `counters.project_no` to 1006 (it is 1000 while AB-1001..1005 exist, so a blank "auto" number collides).
   Same counter check in `scripts/demo/seed-acme.mjs` so a reseed ends with the counter past the last project.
2. **Stray project.** Delete project 7 (`SO-5`, Greenfield, 2 BOM lines, created 2026-11-17 10:59, duplicates
   AB-1005) through Delete Entire Project (`lib/project-delete.js`), not raw SQL.
3. **Card visibility** (`app/projects/[id]/page.js`, all deployments): a department card appears when the project
   reaches that department.
   - Procurement: only once `release_bom` is done (today: any BOM line). Keep the card once shown.
   - Dispatch: once a production hand-over exists or a packing list exists (today: always, unless split master).
   - Production: fix operator precedence (`enabled && (jobCards || indents)`).
   - Check Stores/QC gates read the same way; QC stays visible to QC users (way in).
4. **Item Master.** Demo has 225 items (124 pipes, 43 plates, 40 bought-out; no valves, electrical, fittings,
   refractory), so 64 of SO-6's 81 lines are not linked. Copy the client's Item Master into golden the way
   `scripts/demo/add-shop-demo.mjs` copies products: names cleaned with `scripts/demo/deny-list.mjs`, no prices/costs,
   no supplier names, idempotent, `--apply`/dry run. Keep existing demo items (their part_no drives 3D). Then link
   SO-6's lines (catalog-suggestions route or the resolve dialog) and confirm the readiness tile reaches ~0.
5. **Accounts data** for a "complete accounting" chapter: seed fixed assets + one depreciation run, a GST filing
   marked filed for last month, TDS on supplier bills (TDS register non-empty), bank reconciliation (some lines
   reconciled), so Trial Balance, P&L, Balance Sheet, Cash Flow, GSTR-1/3B, TDS register, Fixed Asset Register all
   show real numbers. Add to `seed-acme.mjs` too.
6. **E-way bill, demo only.** No NIC account is possible without a real GSTIN. Under `DEMO_MODE` only,
   `lib/eway-bill.js` returns a simulated NIC response (12-digit number, date, valid-until by distance, cancel works)
   and the card says "Simulated (demo)". Client build behaviour unchanged. Check the scrub/strip steps still pass.
7. **Dry run + fast-forward.** On a scratch copy of golden, take AB-1006 from Release BOM to dispatch and
   commissioning; list every break, empty screen, slow step. Then `scripts/demo/fast-forward-ab1006.mjs <stage>`
   (stages: procured, received, routed, produced, qc-done, packed, dispatched, commissioned, invoiced) that does all
   lines except 2–3 per department left for recording live. Uses the API like `seed-acme.mjs`.

Out of scope now: Excel import, US changes (note them in `docs/us-version-pending.md` instead).
Verify each step on a scratch DB first; `npm run check` before each commit; ask before writing golden.
