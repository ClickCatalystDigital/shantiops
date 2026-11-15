# US version (boiler-erp-us, branch `demo-us`): what's in, what's pending

The US demo runs from the `demo-us` branch: its own Worker (`wrangler.us.jsonc`, `npm run deploy:demo:us`) and its own
databases (`sb-us-demo-golden`, `sb-us-demo`). It is not deployed by the main-branch pipeline. Main is merged into
`demo-us` by hand, so every India-side fix must also be merged there. This file is the checklist.

## Brought over on 2026-11-15 (main merged into `demo-us`)

- **Calc Sheets screens**:
  - Sidebar Calculation / Formulas / Audit / Calc Links, with Registry, Library, Tables and Portfolio under Advanced.
  - Download PDF on the Worksheet.
  - Audit lists snapshots first.
  - PDF opens with the checks summary and prints at Letter size.
  - `/calc` lists every sheet with search and a project picker.
  - Any sheet can be deleted.
- **Calc Sheets engine side**: grouped and labelled inputs (`calc_input_defs`); a new or empty sheet starts from the
  nearest template plus the project's capacity and pressure. On the US demo this does nothing yet: it has no formulas
  and no templates (see "Pending" below).
- **Migrate guard**: `migrate()` and `scripts/migrate-db.mjs` refuse a demo database without `CUSTOMER_SEED`. For the US
  databases use `CUSTOMER_SEED="$(cat scripts/demo/acme-us-seed.json)"`, never the India seed.
- **Customer role on /demo**: a dropdown of every customer with a portal login (`DEMO_CUSTOMERS_SQL`, only logins linked
  to a customer). On the US demo it lists Greenfield, Bluewater, Great Lakes, Northstar and Riverside.
  `scripts/demo/add-customer-logins.mjs` found every US customer already had one.
- **Drawings**: the 15 US drawing rows got one-page placeholders (lb/hr, psi, 11x17, Acme Boilers Inc.). The US build
  stores demo files under `us/` in the shared bucket `sb-demo-files` (`lib/r2.js` `demoKey`), so the objects are at
  `us/calc-drawings/<id>/1763193600777-us-…` while `calc_drawing_files.file_key` holds the key without `us/`.
- **Demo password step**: a customer created from a Sale Order is marked "must change password"; on both demos the
  portal and Shop now skip that step (`DEMO_MODE`), because the demo enters without a password and blocks changing one.
- **Ember AI, Cue Cards, QC-only switch**: main's later work, with the US-only retirement of the QC hold ("release a held
  job card") kept: that action, its Cue Card and its checks are removed again on `demo-us`.

- **Item Master and 3D (2026-11-16)**: the BOM node Overview tab has the rotating 3D view; the US items already in the
  Item Master get their catalogue code in Part No (`load-item-catalog.mjs --us scripts/demo/us-items.json`), which
  links them to `public/models/us`.

## Pending (deferred while the India version is the focus)

1. **ASME calculation set**, the US equivalent of `lib/calc-sets/ibr-1950-shell-boiler.json`:
   - ASME Section VIII Div. 1 (or Section I for power boilers, to confirm with the customer): shell UG-27, heads UG-32,
     nozzle reinforcement UG-37, hydrotest UG-99, MAWP.
   - Allowable stress typed in by the engineer; no Section II-D tables, which are licensed.
   - Inputs labelled in US units; the engine already converts units.
   - Templates by US sizes (lb/hr or BHP, psi).
   - A self-check like `scripts/calc-set-ibr-selfcheck.mjs` against a real worked ASME calculation.
   - Load with `scripts/load-calc-set.mjs` into both US databases.
   - Then rebuild the 5 US demo snapshots, which are empty today (0 formulas), the way the India ones were rebuilt.
2. **Calc PDF and help wording for the US**: the references section cites the formula's own standard, so it follows the
   set. The Design help text still says "IBR" in places.
3. **US Design demo flow**: a BOM structure template (India has "MF 2000 standard"; the US demo has none) and real-looking
   GA / foundation drawings, if the US video needs them. The placeholders are enough otherwise.
4. **US Sale Order to project walkthrough**: India has SO-6 for the video; the US demo has no equivalent recorded flow.
5. **Calc from chat** (`docs/calc-sheets-ember-mcp-plan.md`): build once for both. The ASME set must exist first for
   the US answers to mean anything.
6. **Duplicate `greenfield` login on the US demo** (not linked to any customer): hidden from the dropdown. Delete it from
   both US databases when convenient.

## How to bring the next main changes over

1. `cd ../shanti-ops-us`, then `git merge main`. Resolve conflicts: keep US wording (`IS_US`) and US-only retirements.
2. `npm run check`.
3. `CUSTOMER_SEED="$(cat scripts/demo/acme-us-seed.json)" TURSO_URL=libsql://sb-us-demo-golden-pujan.aws-ap-south-1.turso.io TURSO_AUTH_TOKEN=… node scripts/migrate-db.mjs`, then the same for `sb-us-demo`.
4. `npm run deploy:demo:us`, then check boiler-erp-us.ahromlabs.com.
