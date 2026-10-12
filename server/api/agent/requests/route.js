// Agent-facing API. Auth = Bearer JWT with role 'agent' + machine_id claim (signAgentToken).
// machine_id comes ONLY from the token — an agent can never touch another machine's rows.
import { NextResponse } from 'next/server';
import { queryOne, execute } from '@/lib/db';
import { getUserFromRequest, isAgent } from '@/lib/auth';
import { effectiveStatus, isLive, normalizeDevice, audit, APPROVAL_MINUTES_DEFAULT } from '@/lib/usb';

export const dynamic = 'force-dynamic';

// Agent-supplied version string — validated before it ever reaches a query (trust boundary).
const VERSION_RE = /^[\w.\-]{1,32}$/;

// Verifies the token and the machines.active kill switch; updates last_seen + agent_version (heartbeat).
async function getMachine(req) {
  const claims = getUserFromRequest(req);
  if (!isAgent(claims) || !claims.machine_id) return null;
  const machine = await queryOne('SELECT * FROM machines WHERE id = ? AND active = 1', [claims.machine_id]);
  if (!machine) return null;
  const versionHeader = req.headers.get('x-agent-version');
  const version = versionHeader && VERSION_RE.test(versionHeader) ? versionHeader : null;
  await execute('UPDATE machines SET last_seen = CURRENT_TIMESTAMP, agent_version = COALESCE(?, agent_version) WHERE id = ?',
    [version, machine.id]);
  return machine;
}

async function latestRequest(machineId) {
  return queryOne(
    `SELECT r.*, d.vendor_id, d.product_id, d.serial, d.label, d.kind
       FROM usb_requests r JOIN usb_devices d ON d.id = r.device_id
      WHERE r.machine_id = ? ORDER BY r.id DESC LIMIT 1`,
    [machineId]
  );
}

function requestJson(row) {
  return {
    id: row.id,
    status: effectiveStatus(row),
    expires_at: row.expires_at,
    device: { kind: row.kind, vendor_id: row.vendor_id, product_id: row.product_id, serial: row.serial, label: row.label },
  };
}

// Agent reports a detected device → returns the live request for it (creating one if needed).
export async function POST(req) {
  const machine = await getMachine(req);
  if (!machine) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  let dev;
  try {
    dev = normalizeDevice(await req.json());
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: 400 });
  }

  let device = await queryOne(
    'SELECT * FROM usb_devices WHERE vendor_id = ? AND product_id = ? AND serial = ?',
    [dev.vendor_id, dev.product_id, dev.serial]
  );
  if (!device) {
    const { lastId } = await execute(
      'INSERT INTO usb_devices (vendor_id, product_id, serial, label, kind) VALUES (?, ?, ?, ?, ?)',
      [dev.vendor_id, dev.product_id, dev.serial, dev.label, dev.kind]
    );
    device = { id: Number(lastId), whitelisted: 0 };
  }

  // Idempotent: re-POST of a device with a live request returns that request.
  const last = await latestRequest(machine.id);
  if (last && last.device_id === device.id && isLive(last)) {
    return NextResponse.json(requestJson(last));
  }

  if (device.whitelisted) {
    // Whitelisted devices get the same time-boxed approval — agent renews by re-POSTing on expiry.
    const expires = Date.now() + APPROVAL_MINUTES_DEFAULT * 60 * 1000;
    const { lastId } = await execute(
      `INSERT INTO usb_requests (machine_id, device_id, status, decided_at, decided_by, expires_at)
       VALUES (?, ?, 'approved', CURRENT_TIMESTAMP, 'auto-whitelist', ?)`,
      [machine.id, device.id, expires]
    );
    await audit('auto_approved', { request_id: Number(lastId), machine_id: machine.id, actor: 'auto-whitelist' });
    return NextResponse.json({ id: Number(lastId), status: 'approved', expires_at: expires });
  }

  const { lastId } = await execute(
    'INSERT INTO usb_requests (machine_id, device_id) VALUES (?, ?)',
    [machine.id, device.id]
  );
  await audit('requested', {
    request_id: Number(lastId), machine_id: machine.id, actor: machine.name,
    detail: `${dev.vendor_id}:${dev.product_id} ${dev.label || ''}`.trim(),
  });
  return NextResponse.json({ id: Number(lastId), status: 'pending', expires_at: null });
}

// Poll: current state of this machine's latest request.
export async function GET(req) {
  const machine = await getMachine(req);
  if (!machine) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  // Auto-update hints: agent self-installs when latest_version is newer AND update_url is set.
  const latest_version = process.env.AGENT_LATEST_VERSION || null;
  const update_url = process.env.AGENT_UPDATE_URL || null;
  const last = await latestRequest(machine.id);
  if (!last) return NextResponse.json({ status: 'idle', latest_version, update_url });
  return NextResponse.json({ ...requestJson(last), latest_version, update_url });
}
