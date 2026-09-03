// components/AccBpmnAtlas.jsx — the Accounts workflow audit + BPMN drawing guide, rendered at
// /acc-bpmn. Every workflow/gap here was traced against the live codebase in one audit pass — no
// live data, so this is a plain server component (native <details> needs no client JS at all).
import styles from '@/app/acc-bpmn/acc-bpmn.module.css';

function Chip({ dept, children }) {
  return (
    <span className={styles.chip} style={{ '--c': `var(--dept-${dept})` }}>
      {children}
    </span>
  );
}
function Arrow() {
  return <span className={styles.arrow}>→</span>;
}
function DeptTag({ dept, children }) {
  return (
    <span className={styles.deptTag}>
      <span className={styles.deptDot} style={{ '--c': `var(--dept-${dept})` }} />
      {children}
    </span>
  );
}
function Gapline({ tag, brick, children }) {
  return (
    <div className={`${styles.gapline} ${brick ? styles.gaplineBrick : ''}`}>
      <span className={styles.tag}>{tag}</span> {children}
    </div>
  );
}

const WORKFLOWS = [
  {
    id: 'w1', open: true, name: 'Quotation → Sale Order → Project',
    strip: [
      ['sales', 'Lead (optional)'], ['sales', 'Opportunity'], ['sales', 'Quotation drafted'],
      ['sales', 'Customer accepts'], ['sales', 'Convert to Sale Order'], ['sales', 'Convert to Project'],
    ],
    departments: [['sales', 'Sales / Marketing raises & converts'], ['accounts', 'Accounts reads company for GL scoping downstream']],
    documents: ['leads', 'opportunities', 'quotations', 'sale_orders', 'projects (auto-seeds 25 milestones + Scope of Supply)'],
    ledger: 'None — entirely pre-revenue. No journal entry until W2’s Sales Invoice.',
    ends: 'Project created, active. Feeds Engineering (BOM), then W2.',
    gaps: [{ tag: 'Gap', text: 'Neither the Quotation→Invoice nor PO→Vendor-Bill convert routes expose a company picker — both silently default to the derived/first company. Fine today (2 companies), a real limitation if a third is onboarded.' }],
  },
  {
    id: 'w2', name: 'Sales Invoice → GST Posting → Credit Note',
    strip: [
      ['sales', 'Accepted Quotation'], ['sales', 'Convert to Invoice (draft)'], ['sales', 'Mark issued'],
      ['accounts', 'GL auto-posts'], ['sales', '(optional) Credit Note issued'], ['accounts', 'GL reversal auto-posts'],
    ],
    departments: [['sales', 'Sales creates & issues'], ['accounts', 'Accounts reads for GSTR-1, settles via W3']],
    documents: ['sales_invoices / sales_invoice_items', 'sales_credit_notes'],
    ledger: 'Dr Accounts Receivable / Cr Revenue / Cr GST Output Payable — CGST+SGST if intra-state, IGST if inter-state. Reverse-charge variant drops the GST Output line entirely (buyer self-assesses). Credit Note reverses Revenue/AR by the credited amount.',
    ends: '“issued” (feeds GSTR-1, awaits W3) or “paid” once fully collected.',
    gaps: [
      { tag: 'Fixed', text: 'This route posts the ledger entry before flipping status — a failed post can never leave a stale “issued” status with no entry behind it. Confirmed correct in code.' },
      { tag: 'Gap', text: 'Reverse-charge sales invoices are code-reviewed and math-checked, never exercised against a real invoice — deliberately, since testing would burn a real invoice number in the GST-numbered sequence.' },
    ],
  },
  {
    id: 'w3', name: 'Customer Receipt (AR Settlement)',
    strip: [['sales', 'Invoice issued'], ['accounts', 'Record receipt (amount, date, ref)'], ['accounts', 'GL posts'], ['accounts', 'Fully settled? auto-flip to Paid']],
    departments: [['accounts', 'Accounts, or Sales/PM']],
    documents: ['customer_receipts (real numbered series, per company per FY)'],
    ledger: 'Dr Bank & Cash / Cr Accounts Receivable. Balance due is computed live from prior receipts, never a stored running total — an over-payment is rejected outright.',
    ends: 'Invoice status flips to “paid” by a direct update once fully settled — deliberately not the status-PATCH route, so it can’t re-trigger a duplicate posting.',
    gaps: [],
  },
  {
    id: 'w4', name: 'Dispatch, Freight & E-Way Bill',
    strip: [
      ['prod', 'BOM item production_done'], ['dispatch', 'Packing list drafted'],
      ['dispatch', 'Link invoice + freight + e-way fields'], ['dispatch', 'Dispatched'],
      ['accounts', 'Post freight (optional)'], ['dispatch', 'Generate / cancel e-way bill (optional)'],
    ],
    departments: [['prod', 'Production gates readiness'], ['qc', 'QC dispatch-eligibility flag'], ['dispatch', 'Dispatch runs it'], ['accounts', 'Accounts reads via Dispatch Register']],
    documents: ['packing_lists / packing_items', 'e-way bill number + validity stamped back on receipt'],
    ledger: 'Dr Freight & Transportation Expense / Cr Bank & Cash — only when the company bears freight; skipped entirely when the customer pays it. Own explicit action, never a PATCH side effect.',
    ends: 'Packing list “dispatched”; freight posted or intentionally not.',
    gaps: [
      { tag: 'Known, intentional', text: 'The real NIC e-way-bill call is stubbed — every prerequisite (distance, HSN, customer/company completeness, encrypted credentials) is built and validated, but the actual government API throws “not implemented” until a real production account exists.' },
      { tag: 'Gap', text: 'E-way-bill line items are sourced from the linked Sales Invoice, which assumes the packing list represents the invoice in full. A genuine partial shipment against one invoice has no link to say which invoice lines are actually in this packing list.' },
      { tag: 'Gap', text: 'GTA reverse-charge GST on the freight leg — a real Indian tax nuance — isn’t modelled; freight always posts as a flat, non-GST expense.' },
    ],
  },
  {
    id: 'w5', name: 'Sales Return',
    strip: [['sales', 'Return raised'], ['sales', 'Inspection (accept / reject)'], ['stores', 'Restock or Scrap']],
    departments: [['sales', 'Sales raises & inspects'], ['stores', 'Stores physically restocks']],
    documents: ['sales_returns'],
    ledger: 'None automatically. on_hand credits directly on Restock — no journal entry fires from this workflow by itself.',
    ends: '“returned_to_stock” or “scrapped”. credit_note_ref is a free-text field a human fills in if a Credit Note (W2) was separately issued.',
    gaps: [{ tag: 'Broken handoff', brick: true, text: 'sales_returns.credit_note_ref has no real link to sales_credit_notes — nothing forces the two to actually agree. A return can be marked “credited” against a note number that was never issued, or the wrong one.' }],
  },
  {
    id: 'w6', open: true, name: 'Purchase Order → Vendor Bill → GST/TDS Posting',
    strip: [
      ['proc', 'PO drafted → issued'], ['proc', 'Record Bill (against the PO)'], ['proc', '(optional) select TDS section'],
      ['proc', 'Approved / Paid'], ['accounts', 'GL posts'], ['proc', '(optional) Debit Note issued'],
    ],
    departments: [['proc', 'Procurement runs the whole thing'], ['accounts', 'Accounts settles via W7']],
    documents: ['purchase_orders / po_items', 'vendor_bills / vendor_bill_items', 'purchase_debit_notes'],
    ledger: 'Dr Raw Material Inventory (or relevant expense) / Dr GST Input Credit / Cr Accounts Payable / Cr TDS Payable if a section was selected. Reverse-charge variant additionally credits GST Output Payable (self-assessed) and drops the vendor-owed GST.',
    ends: 'Bill “approved” or “paid” (via W7). A resolvable line also receives real stock at weighted-average cost, updating inventory_items.avg_cost.',
    gaps: [
      { tag: 'Fixed', text: 'Posts the ledger entry before flipping status — confirmed correctly ordered. This is the pattern every other posting route should match.' },
      { tag: 'Proven', text: 'The full RCM + TDS combination was run once as a real disposable transaction and found two real bugs (a double tax-exclusion, and this exact status-before-post ordering) — both fixed. RCM here is proven, not just reviewed.' },
    ],
  },
  {
    id: 'w7', name: 'Vendor Payment (AP Settlement)',
    strip: [['proc', 'Bill approved'], ['accounts', 'Record payment'], ['accounts', 'GL posts'], ['accounts', 'Fully settled? auto-flip to Paid']],
    departments: [['accounts', 'Accounts, or Procurement/PM']],
    documents: ['vendor_payments (real numbered series)'],
    ledger: 'Dr Accounts Payable / Cr Bank & Cash. Same live-balance, over-payment-rejected discipline as W3.',
    ends: 'Bill flips to “paid”.',
    gaps: [],
  },
  {
    id: 'w8', name: 'Purchase Return',
    strip: [['proc', 'Return raised against a PO line'], ['proc', 'Inspection (accept / reject)'], ['stores', 'Removed from stock / Replaced / None']],
    documents: ['purchase_returns'],
    ledger: 'None automatically. Same shape as W5, mirrored.',
    ends: 'Stock action recorded; debit_note_ref is free text.',
    gaps: [{ tag: 'Broken handoff', brick: true, text: 'Same as W5’s Sales Return — purchase_returns.debit_note_ref has no real FK to purchase_debit_notes.' }],
  },
  {
    id: 'w9', name: 'Material Issue → Consumption Costing',
    strip: [['stores', 'Stores / Production issues against a BOM line'], ['stores', 'on_hand decremented (or batch/serial allocated)'], ['accounts', 'GL posts, if costable']],
    departments: [['stores', 'Stores / Production']],
    documents: ['material_issues'],
    ledger: 'Dr Material Consumed / Cr Raw Material Inventory — only when the line resolves to a real catalog item with a known cost. An unresolvable line issues with zero costing, silently.',
    ends: 'Issue recorded; feeds Job Card / Work Order material consumption.',
    gaps: [{ tag: 'Confirmed bug', brick: true, text: 'The scalar-stock branch decrements on_hand and inserts the material_issues row before attempting the ledger post, with no wrapping transaction. If the post throws, stock is already short with no journal entry and nothing to roll it back.' }],
  },
  {
    id: 'w10', name: 'Fixed Asset: Purchase → Depreciation → Disposal',
    strip: [
      ['accounts', 'Add fixed asset'], ['accounts', 'GL posts'], ['accounts', 'Run depreciation (periodic)'],
      ['accounts', 'GL posts (one combined entry)'], ['accounts', 'Dispose'], ['accounts', 'GL posts gain/loss'],
    ],
    documents: ['fixed_assets', 'depreciation_runs / depreciation_run_lines'],
    ledger: 'Purchase: Dr Fixed Assets. Depreciation: Dr Depreciation Expense / Cr Accumulated Depreciation, one entry per company per period. Disposal: clears cost + accumulated depreciation, plugs the difference to Gain/Loss on Disposal.',
    ends: '“active” → “disposed” (permanent — a mis-entered asset is corrected by disposing it at ₹0, never edited in place).',
    gaps: [
      { tag: 'Confirmed bug', brick: true, text: 'Both Purchase and Depreciation Run write their rows before posting the ledger entry. Depreciation is the worse case: its idempotency guard is a plain “does a run for this period already exist” check — if a run’s ledger post fails, the run row already exists, so a retry silently reports “already ran” and the entry can never be posted.' },
      { tag: 'Correct', text: 'Disposal is the one fixed-asset action that posts before updating status — the pattern the other two should follow.' },
    ],
  },
  {
    id: 'w11', open: true, name: 'Salary Slip → GL Posting → Export Tracking',
    strip: [['hr', 'Draft'], ['hr', 'Submitted'], ['hr', 'Marked Paid'], ['accounts', 'GL posts'], ['accounts', 'export status: not_exported → exported → reconciled']],
    departments: [['hr', 'HR creates & marks paid'], ['accounts', 'Accounts toggles export status only']],
    documents: ['salary_slips'],
    ledger: 'Dr Salary Expense (gross + employer PF/ESI share) / Cr Bank & Cash (net pay) / Cr each statutory payable (PF, ESI, PT, TDS) — fires only on the transition into “paid”.',
    ends: 'Slip “paid”, ledger posted (if it succeeded).',
    gaps: [
      { tag: 'Confirmed bug', brick: true, text: 'Status flips to “paid” before the ledger post is even attempted — and there’s no try/catch around it at all. A throw here 500s the whole request after the status change has already committed, leaving a “paid” slip with no journal entry.' },
      { tag: 'Gap', text: 'No link exists from a posted salary journal entry back to which slip produced it, visible on the Accounts side — reconciling GL against payroll means cross-referencing by date and amount, not a real key.' },
    ],
  },
  {
    id: 'w12', open: true, name: 'Manual Journal Entry',
    strip: [['accounts', 'Draft (can be unbalanced)'], ['accounts', 'Edit'], ['accounts', 'Post (period-lock + balance checked)'], ['accounts', '(optional) Reverse']],
    documents: ['journal_entries / journal_entry_lines'],
    ledger: 'Whatever the user enters — this is the ledger. A reversal creates a new, mirrored entry; the original stays posted, untouched.',
    ends: '“posted” (immutable) or “reversed”.',
    gaps: [{ tag: 'No gaps found', text: 'Deliberately the one place a human can fix anything the automatic triggers miss — correctly gated behind books-lock and balance validation.' }],
  },
  {
    id: 'w13', name: 'Bank Reconciliation',
    strip: [['accounts', 'Upload bank statement'], ['accounts', 'Preview: auto-matched / needs review / unmatched'], ['accounts', 'Confirm — high-confidence lines reconcile'], ['accounts', 'Quick-JE for anything unmatched']],
    documents: ['None new — a reconciled flag on existing journal_entry_lines. A Quick-JE posts a real 2-line manual entry.'],
    ends: 'Every Bank & Cash line either reconciled or sitting for manual review.',
    gaps: [{ tag: 'Gap', text: 'The bank-statement column-header mapping is only proven against hand-built synthetic CSVs — never a real export from an actual bank. Run it against a real file before trusting the auto-match on day one.' }],
  },
  {
    id: 'w14', open: true, name: 'GSTR-1 / IFF (Outward)',
    strip: [['accounts', 'Reads Sales Invoice lines live'], ['accounts', 'B2B + HSN summary computed'], ['accounts', 'Mark filed (a marker only)']],
    ledger: 'None — pure report.',
    ends: 'A gst_filings marker row. The actual filing happens on the government portal, by a human, outside Shanti Ops.',
    gaps: [],
  },
  {
    id: 'w15', name: 'GSTR-2B → IMS → ITC Reconciliation → GSTR-3B',
    strip: [
      ['external', 'GST portal export'], ['accounts', 'Upload / manual add'], ['accounts', 'IMS: accept / reject per line'],
      ['accounts', 'Match against Vendor Bills'], ['accounts', 'GSTR-3B nets it against outward tax'],
    ],
    documents: ['gstr2b_lines'],
    ledger: 'None — reconciliation only, against the Vendor Bill ledger that’s already the source of truth.',
    gaps: [{ tag: 'Gap, accepted', text: 'No Rule 42/43 proportional ITC reversal — a real accounting nuance for exempt supplies, deliberately deferred. Matching is exact (GSTIN + invoice number), no fuzzy fallback by design.' }],
  },
  {
    id: 'w16', name: 'TDS Deduction Register',
    strip: [['accounts', 'Reads Vendor Bills’ frozen TDS snapshot'], ['accounts', 'Grouped by FY / quarter / section / PAN']],
    ends: 'A report handed to whoever files the quarterly 26Q — does not generate the TRACES-format return itself.',
    gaps: [],
  },
  {
    id: 'w17', name: 'Statutory Rate Sync (Cross-System)',
    strip: [
      ['external', 'Human drafts a rate change (Hub)'], ['external', 'Approved (Hub)'], ['external', 'Cloudflare Cron fires daily'],
      ['accounts', 'Idempotent sync into Shanti Ops'], ['external', 'Heartbeat + dead-man’s-switch ping'],
    ],
    documents: ['gst_rates', 'vendor_tds_rates', 'income_tax_slabs', 'professional_tax_slabs'],
    gaps: [
      { tag: 'Draw as a second pool', text: 'This is the one workflow that genuinely crosses an organisation boundary — the Statutory Rates Hub is a separate system. Model it as its own BPMN pool, connected to Shanti Ops’ pool by a message flow, not as another lane.' },
      { tag: 'Gap', text: 'The Hub’s own retraction model doesn’t push a correction to a tenant that already pulled a since-retracted rate.' },
    ],
  },
  {
    id: 'w18', open: true, name: 'Company Onboarding',
    strip: [['accounts', 'Accounts Head creates a company'], ['accounts', 'Chart of Accounts auto-seeded (20 rows, same transaction)']],
    ends: 'New legal entity, ready for transactions.',
    gaps: [],
  },
  {
    id: 'w19', name: 'GSTIN Verification / Company Entities Refresh',
    strip: [['accounts', 'Refresh from GST'], ['external', 'Sandbox/Quicko lookup'], ['accounts', 'Diff preview (new / safe / manual-conflict)'], ['accounts', 'Confirm selected fields']],
    gaps: [{ tag: 'Gap', text: 'Code-complete but never exercised end-to-end with a real response — the external Sandbox/Quicko lookup is a paid, rate-limited call.' }],
  },
  {
    id: 'w20', name: 'E-Way Bill Credential Setup',
    strip: [['accounts', 'Accounts enters NIC credentials'], ['accounts', 'Encrypted at rest'], ['accounts', 'Test Connection'], ['dispatch', 'Unlocks W4’s Generate action']],
    gaps: [{ tag: 'Prerequisite, not a workflow', text: 'Draw this as a gate feeding into W4, not a standalone process.' }],
  },
];

const GROUPS = [
  { id: 'revenue', title: 'Revenue Cycle', note: 'The order-to-cash chain. Five workflows, chained end to end: a Sale Order becomes a Project, a Project produces an Invoice, an Invoice is collected and shipped.', ids: ['w1', 'w2', 'w3', 'w4', 'w5'] },
  { id: 'procurement', title: 'Procurement Cycle', note: 'The purchase-to-pay mirror of the Revenue Cycle, plus the one place inventory actually gets valued.', ids: ['w6', 'w7', 'w8', 'w9', 'w10'] },
  { id: 'payroll', title: 'Payroll', note: 'The one workflow that lives mostly inside HR, and only touches Accounts at the very end.', ids: ['w11'] },
  { id: 'ledger', title: 'Ledger & Bank', note: 'Accounts’ own workspace — the escape hatch for anything the automatic triggers above don’t cover, plus reconciling what actually happened in the bank.', ids: ['w12', 'w13'] },
  { id: 'compliance', title: 'GST & Statutory Reporting', note: 'Mostly read-only views over the workflows above, not processes of their own — draw these as reports feeding off the diagrams, not as their own swimlane sequence, except W17, which genuinely crosses a system boundary.', ids: ['w14', 'w15', 'w16', 'w17'] },
  { id: 'setup', title: 'Company & Compliance Setup', note: 'Infrequent, one-time workflows — draw these smallest, they rarely repeat.', ids: ['w18', 'w19', 'w20'] },
];

const GAP_REGISTER = [
  { sev: 'sevNew', label: 'New — confirmed in code', title: 'Four postings write state before attempting the ledger entry',
    text: 'Fixed Asset purchase, the depreciation run, the material-issue stock decrement, and salary-slip mark-paid all mutate their own table before calling the ledger post — the exact ordering risk already fixed once in Vendor Bills and Sales Invoices, still present here. The depreciation run is the worst case: its own idempotency check means a failed run can never be retried, since the header row already exists the moment the retry is attempted.',
    files: ['lib/fixed-assets.js', 'lib/material-issues.js', 'app/api/salary-slips/[id]/route.js'] },
  { sev: 'sevKnown', label: 'Known', title: 'Returns and their notes/credit documents aren’t actually linked',
    text: 'Both Sales Returns and Purchase Returns reference a Credit/Debit Note by a free-text field, not a real key — nothing stops the two disagreeing or the reference pointing at nothing.',
    files: ['sales_returns.credit_note_ref', 'purchase_returns.debit_note_ref'] },
  { sev: 'sevKnown', label: 'Known', title: 'Reverse charge is proven on purchases, not on sales',
    text: 'Purchase-side RCM was run as a real disposable transaction and had two bugs found and fixed. Sales-side RCM is math-checked and code-reviewed only — deliberately never fired against a real invoice, since that would burn a real number in the GST-numbered invoice sequence.', files: [] },
  { sev: 'sevInfo', label: 'Intentional, not a bug', title: 'E-way bill generation is a stub',
    text: 'Every prerequisite — distance, HSN, customer/company completeness, encrypted credentials, the Cancel flow — is built and validated. The actual NIC API call is not wired, pending a real production account. E-invoicing (researched separately) would change this flow again once/if turned on.', files: [] },
  { sev: 'sevKnown', label: 'Known', title: 'No real HSN-rate lookup in any live calculation',
    text: 'gst_rates (HSN → rate) is a populated master with zero readers — Sales Invoice and Vendor Bill GST is still entered manually, per line, every time.', files: [] },
  { sev: 'sevKnown', label: 'Known', title: 'Payroll has no traceable link back from the ledger',
    text: 'A posted salary journal entry can’t be traced back to the exact slip that produced it from the Accounts side — reconciliation means matching by date and amount, not a key.', files: [] },
  { sev: 'sevKnown', label: 'Known', title: 'The two numbers Payroll’s own GL posting depends on have no HR-facing input',
    text: 'employees.cost_rate_per_hour (feeds W11’s Salary Expense line and Job-Card labour costing) and employees.company (which company’s books a slip posts to) are both API-only — no form field anywhere in HR lets someone set them. Today they’re set however they were seeded; there’s no UI path to correct one for a real employee.',
    files: ['employees.cost_rate_per_hour', 'employees.company'] },
  { sev: 'sevKnown', label: 'Known, accepted', title: 'Not modelled at all',
    text: 'Rule 42/43 proportional ITC reversal · TCS (Section 206C(1H), needs cumulative per-customer threshold tracking) · GTA reverse-charge GST on freight · e-invoicing/IRN (deferred pending real production e-way-bill access) · a company picker on the two “convert” routes.', files: [] },
];

function WorkflowCard({ wf }) {
  return (
    <details className={styles.wf} id={wf.id} open={wf.open || undefined}>
      <summary>
        <span className={styles.wfId}>{wf.id.toUpperCase()}</span>
        <span className={styles.wfName}>{wf.name}</span>
        <span className={styles.wfCaret}>▸</span>
      </summary>
      <div className={styles.wfBody}>
        <div className={`${styles.wfRow} ${styles.wrapStrip}`}>
          {wf.strip.map(([dept, label], i) => (
            <span key={i} style={{ display: 'contents' }}>
              {i > 0 && <Arrow />}
              <Chip dept={dept}>{label}</Chip>
            </span>
          ))}
        </div>
        <dl className={styles.wfMeta}>
          {wf.departments && (
            <>
              <dt>Departments</dt>
              <dd>{wf.departments.map(([dept, label], i) => <DeptTag key={i} dept={dept}>{label}</DeptTag>)}</dd>
            </>
          )}
          {wf.documents && (
            <>
              <dt>Documents</dt>
              <dd className={styles.codeList}>{wf.documents.map((d, i) => <code key={i}>{d}</code>)}</dd>
            </>
          )}
          {wf.ledger && (<><dt>Ledger entries</dt><dd>{wf.ledger}</dd></>)}
          {wf.ends && (<><dt>Ends at</dt><dd>{wf.ends}</dd></>)}
        </dl>
        {(wf.gaps || []).map((g, i) => <Gapline key={i} tag={g.tag} brick={g.brick}>{g.text}</Gapline>)}
      </div>
    </details>
  );
}

const DEPT_LEGEND = [
  ['sales', 'Sales / Marketing'], ['proc', 'Procurement'], ['stores', 'Stores'], ['prod', 'Production'],
  ['dispatch', 'Dispatch'], ['accounts', 'Accounts'], ['hr', 'HR'], ['qc', 'QC'],
  ['external', 'External (Statutory Rates Hub)'],
];

// Every department a workflow touches, derived from its own strip (the one field every workflow
// always has) rather than kept as a second hand-maintained list — so this can't drift from the
// sequence chips themselves.
function buildDeptIndex() {
  const index = {};
  for (const wf of WORKFLOWS) {
    const seen = new Set(wf.strip.map(([dept]) => dept));
    for (const dept of seen) {
      (index[dept] ||= []).push(wf.id);
    }
  }
  return index;
}

function DeptIndex({ byId }) {
  const index = buildDeptIndex();
  return (
    <div className={styles.deptGrid}>
      {DEPT_LEGEND.map(([dept, label]) => {
        const ids = index[dept] || [];
        if (!ids.length) return null;
        return (
          <div className={styles.deptCard} key={dept}>
            <div className={styles.deptCardHead}>
              <span className={styles.deptDot} style={{ '--c': `var(--dept-${dept})` }} />
              <b>{label}</b>
              <span className={styles.deptCount}>{ids.length} workflow{ids.length === 1 ? '' : 's'}</span>
            </div>
            <div className={styles.deptLinks}>
              {ids.map(id => (
                <a key={id} href={`#${id}`} className={styles.wfLink}>{id.toUpperCase()} · {byId[id].name}</a>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}

export default function AccBpmnAtlas() {
  const byId = Object.fromEntries(WORKFLOWS.map(w => [w.id, w]));
  return (
    <div className={styles.atlas}>
      <div className={styles.shell}>
        <nav className={styles.toc}>
          <div className={styles.tocTitle}>Ledger Atlas</div>
          <a className={styles.tocGrp} href="#howto-read">How to read this</a>
          <a className={styles.tocGrp} href="#by-department">By Department</a>
          {GROUPS.map(g => (
            <span key={g.id} style={{ display: 'contents' }}>
              <a className={styles.tocGrp} href={`#${g.id}`}>{g.title}</a>
              {g.ids.map(id => <a key={id} href={`#${id}`}>{id.toUpperCase()} — {byId[id].name}</a>)}
            </span>
          ))}
          <a className={styles.tocGrp} href="#gaps">Gap Register</a>
          <a className={styles.tocGrp} href="#guide">BPMN Drawing Guide</a>
        </nav>

        <main className={styles.main}>
          <header className={styles.pageHeader}>
            <div className={styles.eyebrow}>Shanti Ops · Accounts Audit</div>
            <h1>Every accounting workflow, traced end to end.</h1>
            <p className={styles.dek}>
              Twenty workflows the Accounts module actually runs today — where each one starts, which
              departments touch it, what documents and ledger entries it produces, and where it truly
              ends. Followed by a gap register of every broken handoff found while tracing them, and a
              plain step-by-step guide for turning this into a swimlane BPMN.
            </p>
            <div className={styles.metaRow}>
              <span><span className={styles.dot} /> 20 workflows traced</span>
              <span><span className={styles.dot} /> 4 posting-order bugs confirmed in code</span>
              <span><span className={styles.dot} /> 8 departments, 1 external system</span>
            </div>
          </header>

          <section className={styles.grp} id="howto-read">
            <h2>How to read this</h2>
            <p className={styles.grpNote}>
              Each workflow card opens into: the step sequence as a strip of chips (colour = which
              department is acting), the documents/ledger entries it produces, and where it lands. A
              department’s colour stays the same everywhere on this page — use it to spot who does
              what across every workflow before you start drawing lanes.
            </p>
            <ul className={styles.legend}>
              {DEPT_LEGEND.map(([dept, label]) => (
                <li key={dept}><span className={styles.deptDot} style={{ '--c': `var(--dept-${dept})` }} />{label}</li>
              ))}
            </ul>
          </section>

          <section className={styles.grp} id="by-department">
            <h2>By Department</h2>
            <p className={styles.grpNote}>
              The same 20 workflows, indexed the other way round — every workflow one department
              touches, in one place. Read this before drawing that department’s lane: it’s the
              full list of what actually has to sit on it.
            </p>
            <DeptIndex byId={byId} />
          </section>

          {GROUPS.map(g => (
            <section className={styles.grp} id={g.id} key={g.id}>
              <h2>{g.title}</h2>
              <p className={styles.grpNote}>{g.note}</p>
              {g.ids.map(id => <WorkflowCard key={id} wf={byId[id]} />)}
            </section>
          ))}

          <hr className={styles.rule} />

          <section className={styles.grp} id="gaps" style={{ maxWidth: 900 }}>
            <h2>Gap Register</h2>
            <p className={styles.grpNote}>
              Everything that doesn’t complete cleanly end to end, in one place. “New” means
              confirmed by reading the code during this audit; “Known” means already documented
              and still open; “Info” means an intentional, honestly-flagged incomplete state, not
              a bug.
            </p>
            {GAP_REGISTER.map((g, i) => (
              <div className={styles.gapCard} key={i}>
                <div className={styles.gapCardHead}>
                  <h4>{g.title}</h4>
                  <span className={`${styles.sev} ${styles[g.sev]}`}>{g.label}</span>
                </div>
                <p>{g.text}</p>
                {g.files.length > 0 && (
                  <div className={styles.files}>{g.files.map((f, j) => <code key={j}>{f}</code>)}</div>
                )}
              </div>
            ))}
          </section>

          <hr className={styles.rule} />

          <section className={styles.grp} id="guide" style={{ maxWidth: 900 }}>
            <h2>Drawing this as a BPMN — a plain step-by-step guide</h2>
            <p className={styles.grpNote}>
              Written for drawing this in Lucidchart without needing to already know BPMN. The
              target is one correct, detailed diagram — built as six collapsed sub-processes so
              it stays readable while you build it, not six separate files.
            </p>

            <div className={styles.guideStep}>
              <div className={styles.guideNum}>1</div>
              <div>
                <h4>Pick your pools and lanes before drawing a single arrow</h4>
                <p>One pool = “Shanti Ops.” Inside it, one lane per department that actually
                  <em> does</em> something in the workflow you’re drawing — pull the exact set
                  straight from each workflow card’s Departments line above. Order lanes with the
                  operational departments on top (Sales, Procurement, Stores, Production, Dispatch)
                  and Accounts/HR toward the bottom — most workflows end by landing in Accounts.</p>
                <div className={styles.example}>W17 is the one exception — give the Statutory Rates
                  Hub its own second pool, connected by a dashed message flow. Everything else stays
                  inside one pool.</div>
              </div>
            </div>

            <div className={styles.guideStep}>
              <div className={styles.guideNum}>2</div>
              <div>
                <h4>One diagram, built from six collapsed sub-processes — not six flat diagrams</h4>
                <p>The end goal is one correct, detailed BPMN — not six separate files you have to
                  mentally stitch together. Get there by building six{' '}
                  <em>collapsed sub-process</em> shapes inside the one diagram, one per group on
                  this page: Revenue Cycle (W1–W5),
                  Procurement Cycle (W6–W10), Payroll (W11), Ledger &amp; Bank (W12–W13), GST &amp;
                  Statutory (W14–W17, drawn as data objects feeding the Ledger sub-process, not a
                  sequence of its own), Company Setup (W18–W20). Lucidchart supports collapsed
                  sub-processes natively — double-click to expand one and build its own internal
                  swimlanes without it cluttering the top-level view.</p>
                <div className={styles.example}>Sequence the six sub-processes left to right in the
                  rough order money actually moves: a Sale Order (Revenue Cycle) and a Purchase Order
                  (Procurement Cycle) both feed into Ledger &amp; Bank, which GST &amp; Statutory reads
                  from; Payroll and Company Setup sit lower, since they don’t depend on either cycle to
                  run. Build and prove out each sub-process’s own internal lanes first (steps 3–6 below,
                  one group at a time), then wire the six together last — that’s what keeps one big
                  diagram from turning into an unreadable tangle while you’re still drawing it.</div>
              </div>
            </div>

            <div className={styles.guideStep}>
              <div className={styles.guideNum}>3</div>
              <div>
                <h4>Every accounting document is a Data Object, never a task</h4>
                <p>A task is something someone or something <em>does</em> (“Issue Invoice,”
                  “Record Receipt”). A document — <code>sales_invoices</code>, a Journal
                  Entry — is a Data Object (the little page-icon shape), attached to the task that
                  creates it with a solid line, and to any later task that reads it with a dashed
                  line.</p>
              </div>
            </div>

            <div className={styles.guideStep}>
              <div className={styles.guideNum}>4</div>
              <div>
                <h4>Only draw a gateway (diamond) at a real fork in the process</h4>
                <p>“Reverse charge?”, “Fully settled?”, “Approved or
                  rejected?” are real forks — the process genuinely goes two different ways. A
                  status field with five possible values is <em>not</em> five gateways; it’s one
                  task that lands somewhere, drawn once.</p>
              </div>
            </div>

            <div className={styles.guideStep}>
              <div className={styles.guideNum}>5</div>
              <div>
                <h4>Mark automatic steps so they read differently from a human clicking a button</h4>
                <p>Give any task the system does on its own — “GL Auto-Posts,” “Auto-flip
                  to Paid,” “Weighted-average cost updates” — the small gear-icon marker
                  (BPMN’s Service Task). It’s the fastest way to see, at a glance, how much of
                  a workflow actually runs itself versus needs a human.</p>
              </div>
            </div>

            <div className={styles.guideStep}>
              <div className={styles.guideNum}>6</div>
              <div>
                <h4>Draw the gaps directly on the diagram, not just in a footnote</h4>
                <p>Where the Gap Register above names a broken handoff, draw that exact connection as
                  a dotted red line with a short annotation instead of a normal solid arrow — for
                  example, the Sales Return → Credit Note link that’s really just a human-typed
                  reference, not a real one.</p>
              </div>
            </div>

            <h3 style={{ fontSize: 16, margin: '34px 0 14px' }}>A note on the ordering bugs</h3>
            <p style={{ fontSize: 13.5, color: 'var(--ink-soft)', maxWidth: 640 }}>
              Four workflows (Fixed Asset purchase, Depreciation Run, Material Issue, Salary Slip)
              currently write state before the ledger post; three others (Sales Invoice, Vendor Bill,
              Fixed Asset Disposal) already do it the safe way round. If you want the diagram itself to
              show this, order the two tasks in the opposite sequence for the broken ones and add a
              small warning annotation — it’s a genuinely useful thing to see next to each other on
              paper before it gets fixed in code.
            </p>

            <div className={styles.orderGrid}>
              <div className={`${styles.orderCard} ${styles.orderCardBad}`}>
                <h5>Today (4 workflows)</h5>
                <ol>
                  <li>Write the row / update the status</li>
                  <li>Attempt the ledger post</li>
                  <li>If it fails: state already changed, nothing posted</li>
                </ol>
              </div>
              <div className={`${styles.orderCard} ${styles.orderCardGood}`}>
                <h5>The safe pattern (3 workflows)</h5>
                <ol>
                  <li>Attempt the ledger post</li>
                  <li>Only then write the row / update the status</li>
                  <li>If it fails: nothing has changed yet, safe to retry</li>
                </ol>
              </div>
            </div>

            <h3 style={{ fontSize: 16, margin: '34px 0 14px' }}>Shape legend</h3>
            <div className={styles.notation}>
              <div className={styles.notItem}>
                <svg width="34" height="24" viewBox="0 0 34 24"><rect x="1" y="1" width="32" height="22" rx="8" fill="none" stroke="var(--ink-soft)" strokeWidth="1.5" /></svg>
                <div><b>Task</b><span>a step, human or automatic</span></div>
              </div>
              <div className={styles.notItem}>
                <svg width="34" height="24" viewBox="0 0 34 24">
                  <rect x="1" y="1" width="32" height="22" rx="8" fill="none" stroke="var(--ink-soft)" strokeWidth="1.5" />
                  <circle cx="27" cy="19" r="3.5" fill="none" stroke="var(--ink-soft)" strokeWidth="1.2" />
                  <path d="M25.5 19h3M27 17.5v3" stroke="var(--ink-soft)" strokeWidth="1" />
                </svg>
                <div><b>Automatic task</b><span>gear mark = the system does it</span></div>
              </div>
              <div className={styles.notItem}>
                <svg width="24" height="24" viewBox="0 0 24 24"><path d="M12 1L23 12L12 23L1 12Z" fill="none" stroke="var(--ink-soft)" strokeWidth="1.5" /></svg>
                <div><b>Gateway</b><span>a genuine fork only</span></div>
              </div>
              <div className={styles.notItem}>
                <svg width="22" height="22" viewBox="0 0 22 22"><circle cx="11" cy="11" r="9" fill="none" stroke="var(--ink-soft)" strokeWidth="1.3" /></svg>
                <div><b>Start event</b><span>thin circle</span></div>
              </div>
              <div className={styles.notItem}>
                <svg width="22" height="22" viewBox="0 0 22 22"><circle cx="11" cy="11" r="9" fill="none" stroke="var(--ink-soft)" strokeWidth="3" /></svg>
                <div><b>End event</b><span>thick circle</span></div>
              </div>
              <div className={styles.notItem}>
                <svg width="26" height="30" viewBox="0 0 26 30">
                  <path d="M2 1H18L24 7V29H2Z" fill="none" stroke="var(--ink-soft)" strokeWidth="1.3" />
                  <path d="M18 1V7H24" fill="none" stroke="var(--ink-soft)" strokeWidth="1.3" />
                </svg>
                <div><b>Data object</b><span>a document / GL entry</span></div>
              </div>
              <div className={styles.notItem}>
                <svg width="40" height="14" viewBox="0 0 40 14">
                  <line x1="1" y1="7" x2="34" y2="7" stroke="var(--ink-soft)" strokeWidth="1.5" />
                  <path d="M28 2L34 7L28 12" fill="none" stroke="var(--ink-soft)" strokeWidth="1.5" />
                </svg>
                <div><b>Sequence flow</b><span>solid — same pool</span></div>
              </div>
              <div className={styles.notItem}>
                <svg width="40" height="14" viewBox="0 0 40 14">
                  <line x1="1" y1="7" x2="34" y2="7" stroke="var(--ink-soft)" strokeWidth="1.5" strokeDasharray="3 3" />
                  <circle cx="1" cy="7" r="2.5" fill="var(--ink-soft)" />
                  <path d="M28 2L34 7L28 12" fill="none" stroke="var(--ink-soft)" strokeWidth="1.5" />
                </svg>
                <div><b>Message flow</b><span>dashed — across pools only</span></div>
              </div>
            </div>
          </section>

          <footer className={styles.endNote}>
            Traced against the live Shanti Ops codebase and its own build history (SYSTEM.md). Every
            route path named above is real and current as of this audit.
          </footer>
        </main>
      </div>
    </div>
  );
}
