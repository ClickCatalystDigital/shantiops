'use client';

// Production's Planning module — a durable backlog of work that needs real scoping (no forms, no
// DB table backing the notes themselves) plus, now, a real standalone Cut tab. Same server-page →
// client-workspace shape every other module uses (WorkersPanel.jsx is the direct precedent).
import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { api, showToast } from '@/lib/client';
import WorkspaceSidebar from '@/components/WorkspaceSidebar';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Select, SelectTrigger, SelectValue, SelectContent, SelectGroup, SelectItem } from '@/components/ui/select';
import { ClipboardListIcon, ScissorsIcon } from 'lucide-react';
import CutDialog, { pieceDimsLabel } from '@/components/CutDialog';

const BACKLOG = [
  {
    title: 'Stock-piece Cut needs a real, reachable entry point',
    status: 'Shipped 2026-08-26',
    added: '2026-08-26',
    body: [
      `Resolved — see the "Cut" tab on this page. A piece can now be cut without any BOM line at
       all: pick an item, pick an available piece, declare what was used/kept as remnant, submit.
       cutPiece() already treated project_id/bom_item_id as optional, so this needed no backend
       changes, just a new standalone entry point (components/CutDialog.jsx, generalized out of
       Production's existing BOM-linked Cut dialog).`,
      `Original write-up, kept for history: today, cutting a stock piece (splitting a purchased
       plate/section into used + remnant + scrap) only happened via POST
       /api/stock-pieces/[id]/cut (cutPiece() in lib/stock-pieces.js), gated to Production
       (production.bom.cut). It wasn't a standalone action anywhere — it was reached through
       Production's BOM/Issue-material flow, which auto-matches a stock piece to a BOM line by
       category + MOC (lib/remnant-match.js). A manually-added Stores item with no MOC set (or a
       non-matching grade) had no BOM line it could ever match, so there was no way to cut it
       through the UI at all.`,
    ],
  },
  {
    title: 'No way to issue plain inventory to Production without a project/BOM line',
    status: 'Shipped 2026-09-02 — Material Indent',
    added: '2026-08-26',
    body: [
      `Resolved by the Material Indent hard gate — Production raises an indent
       (material_indents/material_indent_items), Stores explicitly releases against it (partial
       releases allowed, remaining stays open); the material_issues insert itself now happens only
       from that release action (or Stores' own direct-issue card) — POST /api/material-issues is
       Stores-only now, Production can no longer reach it at all. bom_item_id stays required for
       scalar/batch/serial lines (material_issues.bom_item_id is still NOT NULL, no schema
       relaxation this round) — the fully general "no BOM line at all" consumable case named below
       is still explicitly out of scope.`,
      `Original write-up, kept for history: material_issues.bom_item_id is NOT NULL
       (app/api/material-issues/route.js) — every material issuance has to trace to a real
       project's BOM line. There is no path today for Production to draw plain, non-piece-tracked
       inventory (bolts, consumables, etc.) with no project attached at all — that fully general
       case needs an actual table rebuild to relax the NOT NULL constraint, and stays unscoped.`,
    ],
  },
  {
    title: 'Standalone Cut should be able to (or have to) link a project — certificate traceability silently drops without one',
    status: 'Needs scoping',
    added: '2026-08-27',
    body: [
      `Found while reviewing the Cut tab above. cutPiece() (lib/stock-pieces.js) only writes a
       certificate_projects link "if project_id is given AND the source piece has a
       test_certificate_id" — the standalone Cut tab never asks for a project, so cutting a real
       heat-numbered/certified plate there silently drops the certificate-to-project link a
       pressure-vessel/IBR traceability record actually needs. The heat_no/test_certificate_id
       still copy onto the used/remnant/scrap child pieces themselves, so piece-level traceability
       isn't lost — only the "this certified material went into this project" record is.`,
      `Checked whether this also breaks cost/consumption reporting — it doesn't, but only because
       that reporting was already broken independently: Material Consumption and Production Cost
       Variance both read material_issues, not stock_pieces, and cutPiece() never writes to
       material_issues (linked or unlinked, today or before this feature existed). Material
       Utilization / Remnant & Scrap Report does read stock_pieces but keys only on
       inventory_item_id, so it shows unlinked cuts exactly like linked ones. Worth fixing
       separately, but it's not a reason to skip project-linking here.`,
      `Recommendation from the original design discussion, worth revisiting: don't force linking on
       every cut (an ad-hoc scrap-reconciliation cut has no real project), but add an optional
       project picker to the standalone Cut tab, and consider making it required specifically when
       the source piece actually carries a test_certificate_id (the case that matters for
       compliance) rather than always. Also add a plain free-text notes field to CutDialog while
       here — there is currently no "why was this cut" trail anywhere, linked or not.`,
    ],
  },
  {
    title: "No confirmation step for a cut's remnant actually reaching Stores",
    status: 'Needs scoping',
    added: '2026-08-27',
    body: [
      `cutPiece() marks a remnant child piece status='available' the instant the cut is submitted —
       there is no physical handoff/receipt step. A remnant created by Production (via the BOM flow
       or the new standalone Cut tab) becomes reservable/issuable in Stores' inventory immediately,
       before anyone at Stores has actually put the physical piece back on a shelf. Contrast with
       how new purchased material enters stock: Stores themselves run receivePiece() (Add piece),
       so the record and the physical act happen together, same person, same moment.`,
      `Risk: another department could reserve or the system could count on-hand for a remnant that
       physically hasn't left the shop floor yet. This was a smaller risk when cutting only ever
       happened through the tightly-scoped BOM/Issue-material flow (Production working against a
       specific, supervised job); it's more exposed now that the standalone Cut tab makes cutting
       easy to do disconnected from any project or supervision context.`,
      `Needs scoping, not a quick fix: candidates include a new pending/in-transit status between
       "cut" and "available" that Stores has to confirm (mirroring Gate Inward Receipt's own
       open→closed pattern, lib/data.js's getGateInwardReceipts), or accepting the current
       immediate-available behavior as fine for a company this size and only fixing it if it causes
       a real reconciliation problem in practice. Deliberately not deciding here.`,
    ],
  },
];

// Stores' own deferred-issue log — moved here from StoresWorkspace.jsx's own standalone "Backlog"
// nav tab (Stores IA redesign) since a technical debt log a Stores employee scrolls past daily has
// no place in a daily-operations sidebar. Kept as a separate array (not merged into BACKLOG above)
// deliberately — the two lists cover genuinely different domains (Production/Cut vs. Stores/
// material-identity), the same distinction that originally kept them apart; this just gives Stores'
// list a real, non-Stores-nav home instead of dropping it, rendered as its own labeled section.
const STORES_BACKLOG = [
  {
    title: 'Cut-code lineage renumbering: PL-0042-R1 cut again should read PL-0042-U2/-R2, not PL-0042-R1-U1/-R1',
    status: 'Shipped 2026-09-14',
    added: '2026-08-26',
    body: [
      `Resolved — stock_pieces gained a root_id column (self-referencing on every new row;
       cutPiece()'s own \`source.root_id || source.id\` fallback correctly treats a pre-existing NULL
       row as its own root the first time it's ever cut). Every descendant's code is now built off
       the ROOT's own code via a real atomic per-root sequence (nextPieceSeq(), the exact
       INSERT...ON CONFLICT DO UPDATE...RETURNING pattern this note originally pointed at — run
       inside cutPiece()'s own transaction, not the shared nextCounterValue() helper, so a rolled-back
       cut can never leave a permanent gap). Cutting PL-0042-R1 a second time now correctly produces
       PL-0042-U2/PL-0042-R2, not the old compounding PL-0042-R1-U1/-R1.`,
      `Same round: heat number now rides directly in the code (PL-0042-H62A5678, sanitized to A-Z0-9
       and capped at 10 chars) whenever one was captured at receipt — a direct request, so the heat
       is readable off the physical tag without a separate lookup. Verified in
       scripts/remnant-cutting-selfcheck.mjs (a real cut-then-recut-the-remnant scenario, asserting
       the flat U2/R2 numbering and heat inheritance end to end).`,
      `Original write-up, kept for history: cutPiece() (lib/stock-pieces.js) used to build a child's
       code by string-appending onto the immediate PARENT's code (\`\${source.code}-U\${n}\`), not the
       ROOT's — compounding with every cut generation. The genealogy underneath was never affected
       (stock_pieces.parent_id is a real FK, correct at every level regardless of the code string) —
       this was purely a display/ID-generation issue, never a traceability gap.`,
    ],
  },
  {
    title: 'Reserve-from-Stock has no server-side material match — only an advisory, bypassable shortlist',
    status: 'Shipped 2026-09-14',
    added: '2026-08-26',
    body: [
      `Resolved — not by requiring item_id (still sparse on most real rows, exactly the reason this
       was deferred), but by checking the signals that ARE already present on both sides:
       lib/match-utils.js's materialMismatchReason() blocks only on ACTIVE disagreement (both sides
       have a category or moc set, and they genuinely differ — never on one or both being blank), so
       it can't misfire on missing catalog data the way an item_id-only filter would have. category
       is a fixed taxonomy (a plate line can never draw from an angle-section row); moc goes through
       normalizeMaterial()'s strip-all-punctuation equality check, the same one lib/remnant-match.js
       and lib/tc-match.js already trust — never a fuzzy/substring match. Wired into
       reserveFromStock() (lib/procurement.js), the one real choke point behind every Reserve path
       (manual dialog, receipt-driven, and Auto-allocation-mode's own item_id-matched path), so the
       fix covers all three at once. The manual Reserve dialog also shows the same conflict inline
       before submit, not only as a rejected round-trip.`,
      `Original write-up, kept for history: possibleMatches() (StoresWorkspace.jsx) computed a soft,
       client-side shortlist for the Reserve dialog, but it was advisory only — "Show all items"
       always bypassed it, and reserveFromStock() performed zero server-side check that the chosen
       inventory row's material actually matched the BOM line's requirement.`,
    ],
  },
];

function BacklogItems({ items }) {
  return (
    <div className="flex flex-col gap-4">
      {items.map(item => (
        <Card key={item.title}>
          <CardHeader>
            <CardTitle className="flex flex-wrap items-center gap-2">
              {item.title}
              <Badge variant="outline">{item.status}</Badge>
              <span className="text-xs font-normal text-muted-foreground">added {item.added}</span>
            </CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-3 text-sm text-muted-foreground">
            {item.body.map((p, i) => <p key={i}>{p.replace(/\s+/g, ' ').trim()}</p>)}
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

function BacklogTab() {
  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-3">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Production / Cutting</h3>
        <BacklogItems items={BACKLOG} />
      </div>
      <div className="flex flex-col gap-3">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Stores / Material Identity</h3>
        <BacklogItems items={STORES_BACKLOG} />
      </div>
    </div>
  );
}

// Standalone Cut entry point — Material Indent hard gate (Feature B, 2026-09-02): a piece only
// shows up here once it's 'reserved' via a Stores-authorized indent (or the pre-existing automatic
// BOM match, which never routes through this tab — that flow's own Cut button lives in
// WorkersPanel.jsx). No project picker (an unlinked cut, by design — see plan), no BOM line
// required. Only items that could ever have a cuttable piece are listed (track_pieces=1, same
// condition StoresWorkspace.jsx's Inventory tab uses to decide whether to show its own Pieces icon).
function CutStockTab({ inventoryItems }) {
  const router = useRouter();
  const pieceItems = inventoryItems.filter(i => i.track_pieces);
  const [itemId, setItemId] = useState('');
  const [pieces, setPieces] = useState(null);
  const [cutting, setCutting] = useState(null);

  async function load(id) {
    const rows = await api(`/api/stock-pieces?inventory_item_id=${id}`);
    setPieces(rows.filter(p => p.status === 'reserved' && p.indent_item_id));
  }

  useEffect(() => {
    if (!itemId) { setPieces(null); return; }
    load(itemId).catch(err => showToast(err.message, 'error'));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [itemId]);

  const selectedItem = pieceItems.find(i => String(i.id) === itemId);

  return (
    <div className="flex flex-col gap-4">
      <Select value={itemId} onValueChange={setItemId}>
        <SelectTrigger className="w-72"><SelectValue placeholder="Choose an item" /></SelectTrigger>
        <SelectContent><SelectGroup>
          {pieceItems.length === 0
            ? <div className="px-2 py-1.5 text-sm text-muted-foreground">No piece-tracked items</div>
            : pieceItems.map(i => <SelectItem key={i.id} value={String(i.id)}>{i.description}</SelectItem>)}
        </SelectGroup></SelectContent>
      </Select>

      {itemId && (
        <Card>
          <CardContent className="flex flex-col divide-y pt-4">
            {pieces === null ? (
              <p className="py-6 text-center text-sm text-muted-foreground">Loading…</p>
            ) : pieces.length === 0 ? (
              <p className="py-6 text-center text-sm text-muted-foreground">
                No pieces reserved via an indent yet — raise a Material Indent and have Stores
                reserve a piece against it before it can be cut here.
              </p>
            ) : pieces.map(p => (
              <div key={p.id} className="flex flex-wrap items-center gap-3 py-2.5 text-sm">
                <div className="min-w-0 flex-1">
                  <span className="font-medium">{p.code}</span>
                  {/* Context so nobody accidentally cuts a piece reserved for a different job —
                      the actual safety fix in place of restricting who can see it at all. */}
                  <div className="text-xs text-muted-foreground">
                    Indent {p.indent_no} · {p.indent_requested_by || '—'}
                    {p.indent_job_card_id ? ` · Job Card #${p.indent_job_card_id}` : ''}
                  </div>
                </div>
                <span className="text-muted-foreground">{pieceDimsLabel(p)}</span>
                <span className="tnum text-muted-foreground">{p.weight_kg} kg</span>
                <Button size="sm" variant="outline" onClick={() => setCutting(p)}><ScissorsIcon />Cut</Button>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {cutting && (
        <CutDialog initialSource={{ ...cutting, item_description: selectedItem?.description }}
          router={router} onClose={() => setCutting(null)} onDone={() => load(itemId)} />
      )}
    </div>
  );
}

const NAV_ITEMS = [
  { key: 'backlog', label: 'Backlog', icon: ClipboardListIcon },
  { key: 'cut', label: 'Cut', icon: ScissorsIcon },
];

export default function PlanningWorkspace({ inventoryItems }) {
  const [tab, setTab] = useState('backlog');

  return (
    <WorkspaceSidebar title="Planning" icon={ClipboardListIcon} items={NAV_ITEMS} activeKey={tab} onChange={setTab}>
      {tab === 'backlog' && <BacklogTab />}
      {tab === 'cut' && <CutStockTab inventoryItems={inventoryItems} />}
    </WorkspaceSidebar>
  );
}
