# QC-only deployment for the client — plan (2026-11-12)

**Status 2026-11-12: phase 1 (sections 1–4) built and live at sbops.ahromlabs.com; see SYSTEM.md §5fl. Logins: heads of switched-off departments can't sign in, so nothing was deactivated.**

The client's paid scope: milestone tracker (PM, manual), QC / IBR folder, customer dashboard,
security system. BOM, Stores, Procurement, Production, Sales, Dispatch etc. stay switched off.
Phase 1 = QC + projects/milestones, on prod. Portal and security follow.

One codebase. The client deployment gets a list of enabled departments. The Indian demo and the
US demo leave it unset and are unchanged; every QC improvement reaches all of them.

## 1. Department switch (one choke point)

- `ENABLED_DEPARTMENTS` env (e.g. `QC`). Unset = every department, exactly as today.
- `lib/manager-scope.mjs`: `departmentsFor()` also drops disabled departments (Nav already uses
  it). `lib/auth.js` `canAccessDepartment()` returns false for a disabled department, for every
  role including admin. Every page and API route gated by department then refuses on its own.
- Browser copy of the list: an inline script from `app/layout.js` (same pattern as the company
  list, `globalThis.__sbCompanies`), so it is not baked into the build.
- Screens that list departments themselves and must use the filtered list: project page
  department tabs, Operations cards, Home calendar, Settings access matrix / action permissions /
  responsibilities, `/help`, Ember AI (help sections, actions, Cue Cards), Reports catalog,
  alert settings. Milestones of disabled departments stay (the PM closes them by hand — that is
  the manual tracker the client asked for).
- Known gap: a few read-only routes are gated by "any staff" (e.g. a project's BOM). Nothing links
  to them; acceptable.

## 2. QC without BOM / Stores / Production (each change only applies when the module is off)

1. Project picker lists every active project (today: only projects whose BOM is released or
   received, so it would be empty).
2. Hidden tabs: Assign to Units (needs Stores allocation), Job Cards (needs Production),
   Approvals → Inward (Stores), Job Card Stages (Production), Pre-Dispatch (Dispatch).
3. Documents: "Sync from BOM" buttons hidden. Form IV A parts and mountings are entered by hand.
   New for everyone: **paste rows from Excel** into Form IV A parts and mountings (part no, name,
   T/W/L, qty / description, size, MOC, make, qty) — the one real speed-up QC needs without a
   BOM. Also useful on the demo.
4. Test Records: Work Order and assembly pickers hidden. No hydro test for this client: the hydro
   option and its milestone link are hidden when Production is off.
5. NCR: rework/repair need a job card, so only scrap / use as is when Production is off.
6. Test Certificates, Calibration, statutory folder PDF, IBR versions: unchanged.

## 3. Hosting: Workers, same Cloudflare account and paid plan

ahromlabs.com and the three demos already run as Workers on account 5d8cf…; the client becomes a
fourth Worker. No extra cost beyond usage.

- New Worker `sb-ops-client` on `sbops.ahromlabs.com`.
- Build fix first: `DEMO_BUILD` is currently '1' for **every** Workers build, which strips client
  text (help, logins). Make it follow a demo flag, not the target.
- Database: the client's existing Turso DB `shanti-ops-db-shanti` (checked 2026-11-12: 77
  projects, 4 QC documents, 53 parts, 47 certificates, 65 logins). Disabled modules just hidden.
- Files: the client's existing R2 bucket `shantiops` in their own Cloudflare account (97 files,
  reachable with the current keys). Storage stays theirs.
  `SKIP_MIGRATE=1`; CI runs `scripts/migrate-db.mjs` on it before deploying (same as the demo).
- Secrets: the values in `.env.local` — `TURSO_URL/TOKEN`, `SESSION_SECRET`, **same `SECRETS_KEY`**
  (saved credentials stay readable), `R2_*` keys, `BRAND_PREFIX`, `APP_URL`,
  `ENABLED_DEPARTMENTS=QC`.
- CI (`deploy.yml`): checks → demo (canary) → client Worker → wait for its commit. Replaces the
  unused Render step.
- Must test on Workers before handing over:
  - largest real QC folder PDF (memory is 128 MB per request on Workers; the folder merges
    certificate PDFs). If it fails, the PDF route needs a lighter path.
  - R2 upload and download with the client's keys (S3 client on Workers).
- Email: discussed later. Not working on Workers today (nodemailer needs raw SMTP). Also off: the daily
  cron jobs, the device agent's server address. Planned for phase 3.
- Render stays suspended as a fallback until the Worker has run a week.

## 4. Logins

Deactivate every login except QC people and the PM-tier accounts the client uses (decision
needed: who). Others would sign in to an empty Home.

## 5. Later phases

- Customer dashboard: PM switches a customer's portal on from the project / a small Customers
  list (no Sales module). Email to be discussed; until then copy the set-password link.
- Security: agent and extension pointed at the new address; enrolment files re-issued.

## Decisions needed

1. Which logins stay active (default: QC people and PM-tier accounts; the rest deactivated at
   cutover, not deleted, so they come back when a module is switched on).
