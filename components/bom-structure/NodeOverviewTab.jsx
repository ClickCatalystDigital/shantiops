'use client';

// components/bom-structure/NodeOverviewTab.jsx — the selected node's Overview tab: local vs.
// roll-up quantity, node_type, and (per the entity-reference compatibility requirement) a picker
// onto one of the node's own items showing its existing Drawing/PR/PO/Job Card/NCR relations via
// the app's existing RelatedItemsCard — reused, not reimplemented.
import { useState } from 'react';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import RelatedItemsCard from '@/components/RelatedItemsCard';
import { NODE_TYPE_SUGGESTIONS } from '@/lib/bom-tree.mjs';

const OTHER = '__other__';

export default function NodeOverviewTab({ node, onSaveQty, onSaveNodeType }) {
  const [qtyDraft, setQtyDraft] = useState(String(node.qty));
  const isCustomType = node.node_type && !NODE_TYPE_SUGGESTIONS.includes(node.node_type);
  const [customTypeOpen, setCustomTypeOpen] = useState(isCustomType);
  const [customType, setCustomType] = useState(isCustomType ? node.node_type : '');
  const [selectedItemId, setSelectedItemId] = useState('');

  function commitQty() {
    const n = Number(qtyDraft);
    if (n > 0 && n !== node.qty) onSaveQty(n);
    else setQtyDraft(String(node.qty));
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-2 gap-4">
        <div className="flex flex-col gap-1.5">
          <Label>Local quantity</Label>
          <Input
            type="number" min="0" step="any" value={qtyDraft}
            onChange={e => setQtyDraft(e.target.value)}
            onBlur={commitQty}
            onKeyDown={e => e.key === 'Enter' && e.currentTarget.blur()}
          />
          <p className="text-xs text-muted-foreground">How many of this node per its parent.</p>
        </div>
        <div className="flex flex-col gap-1.5">
          <Label>Roll-up quantity</Label>
          <div className="flex h-9 items-center rounded-md border bg-muted/40 px-3 text-sm tnum text-muted-foreground">
            {node.rollup_qty}
          </div>
          <p className="text-xs text-muted-foreground">Computed live from every parent above this node — never hand-edited.</p>
        </div>
      </div>

      {node.items?.length > 0 && (
        <div className="flex flex-col gap-1.5 border-t pt-3">
          <Label>Item relations</Label>
          <Select value={selectedItemId} onValueChange={setSelectedItemId}>
            <SelectTrigger className="w-full"><SelectValue placeholder="Pick an item to see its linked Drawing/PR/PO/Job Cards/NCRs…" /></SelectTrigger>
            <SelectContent>
              {node.items.map(it => <SelectItem key={it.id} value={String(it.id)}>BM-{it.id} · {it.material_description}</SelectItem>)}
            </SelectContent>
          </Select>
          {selectedItemId && <RelatedItemsCard type="bom_item" id={Number(selectedItemId)} className="flex flex-col gap-2" />}
        </div>
      )}

      {/* Type is auto-suggested at creation (name keywords, else hierarchy depth — see
          lib/bom-tree.mjs's suggestNodeType) and rarely needs a second look, so it sits here as a
          small, secondary control rather than a prominent required field. */}
      <div className="flex flex-wrap items-center gap-1.5 border-t pt-3 text-xs text-muted-foreground">
        <span>Classified as</span>
        <Select
          value={customTypeOpen ? OTHER : (node.node_type || '')}
          onValueChange={v => {
            if (v === OTHER) { setCustomTypeOpen(true); return; }
            setCustomTypeOpen(false);
            onSaveNodeType(v);
          }}
        >
          <SelectTrigger className="h-6 w-auto gap-1 border-none bg-transparent px-1.5 text-xs text-foreground shadow-none hover:bg-muted">
            <SelectValue placeholder="Assembly (default)" />
          </SelectTrigger>
          <SelectContent>
            {NODE_TYPE_SUGGESTIONS.map(t => <SelectItem key={t} value={t}>{t}</SelectItem>)}
            <SelectItem value={OTHER}>Other — type your own</SelectItem>
          </SelectContent>
        </Select>
        {customTypeOpen && (
          <Input
            className="h-6 w-40 text-xs" autoFocus placeholder="e.g. Header Assembly" value={customType}
            onChange={e => setCustomType(e.target.value)}
            onBlur={() => customType.trim() && onSaveNodeType(customType.trim())}
            onKeyDown={e => e.key === 'Enter' && e.currentTarget.blur()}
          />
        )}
      </div>
    </div>
  );
}
