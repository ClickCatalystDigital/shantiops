'use client';

// components/PieceLineage.jsx — extracted from components/StoresWorkspace.jsx (gap-closure round,
// 2026-08-26, Pr2). Genealogy (stock_pieces.parent_id) was always real, but the only place a human
// could ever see "this piece came from PL-0042" was Stores' Pieces dialog — Production, cutting a
// piece, had no lineage view at all and would have had to leave its own screen. This is a read-only
// display component: no Reserve/Release/Confirm actions (those stay Stores-only, in
// StoresWorkspace.jsx's own action-ful table, which imports the two pure helpers below instead of
// keeping its own copies).
// Duplicated (not imported) from components/CutDialog.jsx's own pieceDimsLabel — this component is
// used FROM CutDialog.jsx (Pr2's "View lineage" section), so importing it back from there would be
// a circular import. Trivial two-line pure function; keep both copies in lockstep if the shape logic
// ever changes.
function pieceDimsLabel(p) {
  if (p.status === 'scrap') return '—';
  return p.kind === 'plate' ? `${p.length_mm}×${p.width_mm}×${p.thickness_mm} mm` : `${p.length_mm} mm`;
}

// A cut child's code suffix (rootCode()/cutPiece() in lib/stock-pieces.js) already names exactly
// what it is — U(sed)/R(emnant)/S(crap) — more precisely than its bare `status` alone can (a "used"
// child and the root piece post-cut are both just status='consumed'). Read straight from the code
// instead of re-deriving the same distinction from status+source.
export function pieceKindLabel(p) {
  if (/-U\d+$/.test(p.code || '')) return 'Used';
  if (/-R\d+$/.test(p.code || '')) return 'Remnant';
  if (/-S\d+$/.test(p.code || '')) return 'Scrap';
  return null;
}

// One group per originally-received piece (root, `parent_id == null`) — every cut child (used/
// remnant/scrap), at any depth, nests under the root it ultimately came from. Previously only
// collected DIRECT children — a remnant cut a second time (its own used/remnant/scrap) simply
// vanished from this view, present in the data (root_id/parent_id both correct) but never shown.
// Now walks the full descendant tree; each piece carries a `depth` (1 = direct child, 2 =
// grandchild, ...) so the UI can indent proportionally instead of flattening every generation to
// the same level. Children sorted oldest-cut-first (ascending id) for a natural "what happened to
// this piece" reading order, depth-first so a branch's own descendants stay grouped together.
export function groupPiecesByRoot(pieces) {
  const childrenByParent = new Map();
  for (const p of pieces) {
    if (!p.parent_id) continue;
    if (!childrenByParent.has(p.parent_id)) childrenByParent.set(p.parent_id, []);
    childrenByParent.get(p.parent_id).push(p);
  }
  function collectDescendants(parentId, depth, out) {
    const kids = (childrenByParent.get(parentId) || []).sort((a, b) => a.id - b.id);
    for (const k of kids) {
      out.push({ ...k, depth });
      collectDescendants(k.id, depth + 1, out);
    }
  }
  const groups = [];
  for (const p of pieces) {
    if (p.parent_id) continue;
    const children = [];
    collectDescendants(p.id, 1, children);
    groups.push({ root: p, children });
  }
  return groups;
}

function LineageRow({ p, depth }) {
  const kind = pieceKindLabel(p);
  return (
    <div className="flex items-center gap-2 py-1 text-xs" style={{ paddingLeft: depth * 16 }}>
      {depth > 0 && <span className="text-muted-foreground">→</span>}
      <span className="font-medium">{p.code}</span>
      <span className="text-muted-foreground">{pieceDimsLabel(p)} · {p.weight_kg} kg</span>
      {kind && <span className="text-muted-foreground">({kind})</span>}
      {(p.heat_no || p.certificate_no) && (
        <span className="text-muted-foreground">{[p.heat_no, p.certificate_no].filter(Boolean).join(' · ')}</span>
      )}
    </div>
  );
}

// Read-only genealogy tree for one piece's lineage — given the flat `pieces` array a
// `GET /api/stock-pieces?inventory_item_id=`/`?bom_item_id=` call already returns, walks from the
// root down through the currently-selected piece. Pass the full sibling list; it groups internally.
export default function PieceLineage({ pieces, currentPieceId }) {
  const groups = groupPiecesByRoot(pieces || []);
  // Find which root's tree the current piece belongs to (it may be the root itself, or any child).
  const group = groups.find(g => g.root.id === currentPieceId || g.children.some(c => c.id === currentPieceId));
  if (!group) return null;
  if (!group.children.length) return null; // a never-cut root has no lineage to show
  return (
    <div className="rounded-md border bg-muted/20 p-2">
      <LineageRow p={group.root} depth={0} />
      {group.children.map(c => <LineageRow key={c.id} p={c} depth={c.depth} />)}
    </div>
  );
}
