'use client';

// components/bom-structure/NodeOverviewTab.jsx — the selected node's Overview tab: local vs.
// roll-up quantity, node_type, and (per the entity-reference compatibility requirement) a picker
// onto one of the node's own items showing its existing Drawing/PR/PO/Job Card/NCR relations via
// the app's existing RelatedItemsCard — reused, not reimplemented.
import { useEffect, useState } from 'react';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import RelatedItemsCard from '@/components/RelatedItemsCard';
import { api } from '@/lib/client';
import { NODE_TYPE_SUGGESTIONS, effectiveNodeLevel } from '@/lib/bom-tree.mjs';

const OTHER = '__other__';

// Templates one rung below this node's own level become its children when applied — the same rung
// MoveAssemblyDialog's own step-2 picker already uses for "parent one level up." A System-level
// node has no rung above it and is deliberately never offered here — a System-level template can
// only be applied at the project root (the tree pane's own "Build from Templates"), never nested
// under something else.
function childLevelFor(level) {
  const i = NODE_TYPE_SUGGESTIONS.indexOf(level);
  return i >= 0 && i < NODE_TYPE_SUGGESTIONS.length - 1 ? NODE_TYPE_SUGGESTIONS[i + 1] : null;
}

export default function NodeOverviewTab({ node, byId, onSaveQty, onSaveNodeType, onApplyTemplate }) {
  const [qtyDraft, setQtyDraft] = useState(String(node.qty));
  const isCustomType = node.node_type && !NODE_TYPE_SUGGESTIONS.includes(node.node_type);
  const [customTypeOpen, setCustomTypeOpen] = useState(isCustomType);
  const [customType, setCustomType] = useState(isCustomType ? node.node_type : '');
  const [selectedItemId, setSelectedItemId] = useState('');

  const childLevel = childLevelFor(effectiveNodeLevel(node, byId));
  const [templates, setTemplates] = useState(null);
  const [checkedIds, setCheckedIds] = useState(new Set());
  const [applying, setApplying] = useState(false);

  useEffect(() => {
    if (!childLevel) { setTemplates([]); return; }
    setTemplates(null);
    setCheckedIds(new Set());
    api(`/api/bom-structure-templates?level=${encodeURIComponent(childLevel)}`).then(setTemplates).catch(() => setTemplates([]));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [childLevel, node.id]);

  function toggleChecked(id) {
    setCheckedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  async function applySelected() {
    if (!checkedIds.size) return;
    setApplying(true);
    try {
      await onApplyTemplate([...checkedIds]);
      setCheckedIds(new Set());
    } finally { setApplying(false); }
  }

  const totals = templates?.filter(t => checkedIds.has(t.id))
    .reduce((acc, t) => ({ nodes: acc.nodes + t.node_count, items: acc.items + t.item_count }), { nodes: 0, items: 0 });

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

      {childLevel && (
        <div className="flex flex-col gap-2 border-t pt-3">
          <Label>Apply Template</Label>
          {templates === null ? (
            <p className="text-xs text-muted-foreground">Loading {childLevel}-level templates…</p>
          ) : templates.length === 0 ? (
            <p className="text-xs text-muted-foreground">No {childLevel}-level templates saved yet — build this by hand, then "Save as template" from a real node above to create one.</p>
          ) : (
            <>
              <div className="flex max-h-48 flex-col divide-y overflow-y-auto rounded-md border">
                {templates.map(t => (
                  <label key={t.id} className="flex cursor-pointer items-start gap-2 px-2.5 py-2 text-sm transition-colors hover:bg-muted/40">
                    <Checkbox checked={checkedIds.has(t.id)} onCheckedChange={() => toggleChecked(t.id)} className="mt-0.5" />
                    <span className="flex flex-col">
                      <span className="flex items-center gap-1.5">
                        {t.name}
                        {t.is_default ? <span className="text-warning">★</span> : null}
                        {t.series && <span className="rounded-full border px-1.5 py-0 text-[10px] text-muted-foreground">{t.series}</span>}
                      </span>
                      <span className="text-xs text-muted-foreground">
                        {t.node_count} node{t.node_count === 1 ? '' : 's'} · {t.item_count} item{t.item_count === 1 ? '' : 's'}
                        {t.source_project_no ? ` · ${t.source_project_no}` : ''}
                      </span>
                    </span>
                  </label>
                ))}
              </div>
              {checkedIds.size > 0 && (
                <p className="text-xs text-muted-foreground">
                  Inserts {totals.nodes} node{totals.nodes === 1 ? '' : 's'} and {totals.items} item{totals.items === 1 ? '' : 's'} with their saved
                  specs exactly as captured — sizes/quantities may need review for this project's capacity before release.
                </p>
              )}
              <Button size="sm" className="w-fit" disabled={!checkedIds.size || applying} onClick={applySelected}>
                {applying ? 'Applying…' : `Apply ${checkedIds.size || ''} template${checkedIds.size === 1 ? '' : 's'}`.trim()}
              </Button>
            </>
          )}
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
