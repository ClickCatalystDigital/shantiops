// app/api/stock-pieces/[id]/transfer-ownership/route.js — Stores/Inventory hardening Phase 4.
// Explicit, auditable Ownership Transfer — see lib/stock-pieces.js's transferPieceOwnership() for
// the invariants this enforces (forced release + demand-reopen, entity-ID chain untouched, cost/
// value deliberately isolated). Gated the same way the existing manual-reserve route already is —
// Stores owns physical-stock actions, same department + action-permission shape, open by default
// (no seeded Head-gate row) like most Stores actions; can be configured to Head-only later via
// Settings' Action Permissions if that authority decision lands (deliberately deferred, per
// instruction — this affects UX/authority only, not the data model built here).
import { NextResponse } from 'next/server';
import { getFreshSessionUser, requireDepartment } from '@/lib/auth';
import { requireAction } from '@/lib/action-permissions';
import { transferPieceOwnership } from '@/lib/stock-pieces';

export async function POST(req, { params }) {
  const user = await getFreshSessionUser();
  const denied = requireDepartment(user, 'Stores');
  if (denied) return denied;
  const actionDenied = await requireAction(user, 'Stores', 'stores.piece.transfer_ownership');
  if (actionDenied) return actionDenied;

  const b = await req.json();
  const toProjectId = b.to_project_id ? Number(b.to_project_id) : null;
  const reason = String(b.reason || '').trim();
  if (!reason) return NextResponse.json({ error: 'A reason is required' }, { status: 400 });

  try {
    const result = await transferPieceOwnership(Number(params.id), { toProjectId, reason, username: user.username });
    return NextResponse.json({ ok: true, ...result });
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: 400 });
  }
}
