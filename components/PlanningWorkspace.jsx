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
    status: 'Needs scoping',
    added: '2026-08-26',
    body: [
      `Found while scoping the Cut tab above. material_issues.bom_item_id is NOT NULL
       (app/api/material-issues/route.js) — every material issuance has to trace to a real
       project's BOM line. There is no path today for Production to draw plain, non-piece-tracked
       inventory (bolts, consumables, etc.) with no project attached — a standard "Stores Indent" /
       Material Requisition concept, and a normal thing to want in a manufacturing ERP.`,
      `Existing precedent to mirror rather than inventing a new system: Sales already has its own
       "Request from Stores" dialog (components/SalesWorkspace.jsx, the SAS flow), fulfilled
       through the same Reserve/Procure machinery Stores' Open Requests tab already uses. A
       Production indent should probably follow that same request → Stores-fulfills shape.
       Deliberately not scoped further here — needs its own pass.`,
    ],
  },
];

function BacklogTab() {
  return (
    <div className="flex flex-col gap-4">
      {BACKLOG.map(item => (
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

// Standalone Cut entry point — deliberately minimal: pick an item, pick an available piece, cut
// it. No project picker (an unlinked cut, by design — see plan), no BOM line required. Only items
// that could ever have a cuttable piece are listed (track_pieces=1, same condition
// StoresWorkspace.jsx's Inventory tab uses to decide whether to show its own Pieces icon).
function CutStockTab({ inventoryItems }) {
  const router = useRouter();
  const pieceItems = inventoryItems.filter(i => i.track_pieces);
  const [itemId, setItemId] = useState('');
  const [pieces, setPieces] = useState(null);
  const [cutting, setCutting] = useState(null);

  async function load(id) {
    const rows = await api(`/api/stock-pieces?inventory_item_id=${id}`);
    setPieces(rows.filter(p => p.status === 'available'));
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
              <p className="py-6 text-center text-sm text-muted-foreground">No available pieces to cut.</p>
            ) : pieces.map(p => (
              <div key={p.id} className="flex flex-wrap items-center gap-3 py-2.5 text-sm">
                <span className="min-w-0 flex-1 font-medium">{p.code}</span>
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
