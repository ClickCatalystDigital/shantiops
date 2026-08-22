// app/api/company-settings/[id]/verify-gstin/route.js — Company Entities. Two-phase preview/confirm
// GSTIN refresh, same shape as app/api/gstr2b/upload/route.js and
// app/api/reports/bank-reconciliation/import/route.js:
//   POST (no confirm)          → fetch fresh data from the hub's Sandbox passthrough, diff against
//                                 what's stored, return the diff. Nothing written.
//   POST {confirm:1, fields}   → re-fetch (never trust client-supplied fetched values for a
//                                 compliance-relevant write) and apply only the caller-selected
//                                 fields, each stamped source='sandbox' + updated_at=now.
//
// Calls statutory-rates-hub's *existing* /api/gstin/verify route — a passthrough to Sandbox already
// built and tenant-authed there — with the same STATUTORY_RATES_HUB_API_KEY already used for rate
// sync (lib/rate-sync.js). No hub changes needed or made.
import { NextResponse } from 'next/server';
import { execute, queryOne } from '@/lib/db';
import { getFreshSessionUser, requireDepartment } from '@/lib/auth';
import { requireAction } from '@/lib/action-permissions';
import { audit } from '@/lib/usb';
import { mapSandboxResponse, diffCompanyEntity, TRACKABLE_FIELDS, EXTRA_FIELDS } from '@/lib/company-entity.mjs';

async function fetchFromHub(gstin) {
  const baseUrl = process.env.STATUTORY_RATES_HUB_URL;
  const apiKey = process.env.STATUTORY_RATES_HUB_API_KEY;
  if (!baseUrl || !apiKey) throw new Error('STATUTORY_RATES_HUB_URL / STATUTORY_RATES_HUB_API_KEY not configured');
  const res = await fetch(`${baseUrl}/api/gstin/verify`, {
    method: 'POST',
    headers: { 'x-api-key': apiKey, 'Content-Type': 'application/json' },
    body: JSON.stringify({ gstin }),
  });
  let body;
  try {
    body = await res.json();
  } catch {
    // The hub can return a plain HTML error page (e.g. a 404) if its GSTIN-verify route isn't
    // deployed yet — surface that plainly instead of crashing on an "Unexpected token '<'" parse
    // error, same as every other route in this app catches its own errors cleanly.
    throw new Error(`Hub returned a non-JSON response (HTTP ${res.status}) — its GSTIN-verify endpoint may not be deployed yet`);
  }
  if (!res.ok) throw new Error(body.error || `Hub GSTIN verify failed: ${res.status}`);
  return mapSandboxResponse(body);
}

export async function POST(req, { params }) {
  const user = await getFreshSessionUser();
  const denied = requireDepartment(user, 'Accounts');
  if (denied) return denied;
  const actionDenied = await requireAction(user, 'Accounts', 'accounts.company_settings.write');
  if (actionDenied) return actionDenied;

  const current = await queryOne('SELECT * FROM company_settings WHERE id = ?', [params.id]);
  if (!current) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  if (!current.gstin) return NextResponse.json({ error: 'No GSTIN on file to verify against' }, { status: 400 });

  let mapped;
  try {
    mapped = await fetchFromHub(current.gstin);
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: 400 });
  }
  const diff = diffCompanyEntity(current, mapped.trackable);

  const b = await req.json().catch(() => ({}));
  if (b.confirm !== 1) {
    return NextResponse.json({ diff, extra: mapped.extra });
  }

  const selected = new Set(Array.isArray(b.fields) ? b.fields : []);
  const now = new Date().toISOString();
  const sets = [];
  const args = [];
  for (const field of TRACKABLE_FIELDS) {
    if (!selected.has(field)) continue;
    if (field === 'state') {
      sets.push('state = ?', 'state_code = ?', 'state_source = ?', 'state_updated_at = ?');
      args.push(mapped.trackable.state, mapped.trackable.state_code, 'sandbox', now);
    } else {
      sets.push(`${field} = ?`, `${field}_source = ?`, `${field}_updated_at = ?`);
      args.push(mapped.trackable[field], 'sandbox', now);
    }
  }
  // The fetch-only bucket is always refreshed on any confirmed apply — it's one atomic snapshot
  // from the same call, never individually selectable, never in conflict with a manual entry.
  for (const field of EXTRA_FIELDS) { sets.push(`${field} = ?`); args.push(mapped.extra[field]); }
  sets.push('gst_extra_source = ?', 'gst_extra_fetched_at = ?');
  args.push('sandbox', now);

  if (sets.length) {
    args.push(params.id);
    await execute(`UPDATE company_settings SET ${sets.join(', ')} WHERE id = ?`, args);
  }
  await audit('company_entity_gst_refreshed', { actor: user.username, detail: `${current.company}: ${[...selected].join(', ') || '(extra fields only)'}` });
  return NextResponse.json({ ok: true, applied: [...selected] });
}
