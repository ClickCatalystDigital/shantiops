// Unified delivery/lot-centric receiving, Phase 2 — Stores' routing decision (Manufacturing vs.
// Direct to Dispatch) for a normal project or a shared-PR sibling, i.e. any bom_item whose own
// project has NO child units of its own. route-to/route.js can't serve this case (it hard-requires
// the target's own master_project_id to equal this item's project — a normal/sibling project's own
// id can never satisfy that), so this is a second, honest write path onto the same
// bom_item_child_routing table rather than bending one function around two structurally different
// invariants.
//
// child_project_id is ALWAYS the item's own project_id, derived server-side — never accepted from
// the request body. There is no client-submitted identity to validate here at all: the caller only
// ever submits routed_to. "Ready" means the item itself has actually been received
// (purchase_status), not an allocation-ledger check (there's nothing to allocate for a single
// recipient).
import { NextResponse } from 'next/server';
import { getFreshSessionUser, requireDepartment } from '@/lib/auth';
import { requireAction } from '@/lib/action-permissions';
import { execute, queryOne } from '@/lib/db';
import { audit } from '@/lib/usb';

const VALID_ROUTES = new Set(['production', 'dispatch']);

export async function POST(req, { params }) {
  const user = await getFreshSessionUser();
  const denied = requireDepartment(user, 'Stores');
  if (denied) return denied;
  const actionDenied = await requireAction(user, 'Stores', 'stores.bom.route');
  if (actionDenied) return actionDenied;

  const item = await queryOne('SELECT * FROM bom_items WHERE id = ?', [params.id]);
  if (!item) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const b = await req.json();
  const routedTo = String(b.routed_to || '');
  if (!VALID_ROUTES.has(routedTo)) {
    return NextResponse.json({ error: "routed_to must be 'production' or 'dispatch'" }, { status: 400 });
  }

  // A line whose own project IS a split master must route per-child via route-to/route.js instead —
  // this path is specifically for the case with exactly one honest recipient (the item's own project).
  const hasChildren = await queryOne('SELECT 1 FROM projects WHERE master_project_id = ? LIMIT 1', [item.project_id]);
  if (hasChildren) {
    return NextResponse.json({ error: 'This project has child units — route per unit instead' }, { status: 400 });
  }

  if (item.purchase_status !== 'Received') {
    return NextResponse.json({ error: 'Not received yet' }, { status: 400 });
  }

  await execute(
    `INSERT INTO bom_item_child_routing (bom_item_id, child_project_id, routed_to, decided_by)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(bom_item_id, child_project_id) DO UPDATE SET
       routed_to = excluded.routed_to, decided_by = excluded.decided_by, decided_at = CURRENT_TIMESTAMP`,
    [item.id, item.project_id, routedTo, user.username]);

  await audit('bom_item_self_routed', {
    actor: user.username,
    detail: `bom_item #${item.id} -> ${routedTo}`,
  });
  return NextResponse.json({ ok: true, routed_to: routedTo });
}

// Reads the item's own current routing decision, if any — used by the receive dialog to know
// whether this line still needs a routing confirmation, and by getProjectBom-adjacent reads that
// want the self-referential routing state without duplicating the query.
export async function GET(req, { params }) {
  const user = await getFreshSessionUser();
  const denied = requireDepartment(user, 'Stores');
  if (denied) return denied;
  const item = await queryOne('SELECT id, project_id FROM bom_items WHERE id = ?', [params.id]);
  if (!item) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  const routing = await queryOne(
    'SELECT routed_to, decided_by, decided_at FROM bom_item_child_routing WHERE bom_item_id = ? AND child_project_id = ?',
    [item.id, item.project_id]);
  return NextResponse.json({ routing: routing || null });
}
