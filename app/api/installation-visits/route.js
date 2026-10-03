// Installation visits — per-project rows. GET seeds the four default visits the first time a
// project is opened (idempotent: only when it has none).
import { NextResponse } from 'next/server';
import { execute, queryAll, queryOne } from '@/lib/db';
import { getFreshSessionUser, canAccessDepartment } from '@/lib/auth';
import { requireAction } from '@/lib/action-permissions';
import { audit } from '@/lib/usb';
import { syncServiceMilestones } from '@/lib/milestone-auto';

const DEFAULT_VISITS = [
  'Foundation marking (as per site conditions)',
  'Customer needs – issue solving',
  'Pre-commissioning',
  'Commissioning',
];

export async function GET(req) {
  const user = await getFreshSessionUser();
  if (!user || !canAccessDepartment(user, 'Installation')) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  const sp = new URL(req.url).searchParams;
  if (sp.get('overview')) {
    // One row per project: planned (default 4), done, remaining.
    return NextResponse.json(await queryAll(
      `SELECT p.id AS project_id, p.project_no, p.customer_name, p.installation_planned_visits AS planned,
              COALESCE(SUM(v.status = 'done'), 0) AS done, COUNT(v.id) AS total
         FROM projects p LEFT JOIN installation_visits v ON v.project_id = p.id
        WHERE p.status = 'active' AND p.id NOT IN (SELECT master_project_id FROM projects WHERE master_project_id IS NOT NULL)
        GROUP BY p.id ORDER BY p.id DESC`));
  }
  const projectId = Number(sp.get('project_id'));
  if (!projectId) return NextResponse.json({ error: 'project_id is required' }, { status: 400 });
  let rows = await queryAll('SELECT * FROM installation_visits WHERE project_id = ? ORDER BY seq, id', [projectId]);
  if (!rows.length) {
    // One statement so two racing opens can't both seed.
    await execute(
      `INSERT INTO installation_visits (project_id, seq, description, created_by)
       SELECT ?, v.seq, v.d, ? FROM (${DEFAULT_VISITS.map((_, i) => `SELECT ${i + 1} AS seq, ? AS d`).join(' UNION ALL ')}) v
        WHERE NOT EXISTS (SELECT 1 FROM installation_visits WHERE project_id = ?)`,
      [projectId, user.username, ...DEFAULT_VISITS, projectId]
    );
    rows = await queryAll('SELECT * FROM installation_visits WHERE project_id = ? ORDER BY seq, id', [projectId]);
  }
  const proj = await queryOne('SELECT installation_planned_visits AS planned FROM projects WHERE id = ?', [projectId]);
  return NextResponse.json({ rows, planned: proj?.planned ?? 4 });
}

export async function POST(req) {
  const user = await getFreshSessionUser();
  if (!user || !canAccessDepartment(user, 'Installation')) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  const denied = await requireAction(user, 'Installation', 'installation.visit.write');
  if (denied) return denied;
  const b = await req.json();
  const description = String(b.description || '').trim();
  if (!b.project_id) return NextResponse.json({ error: 'project_id is required' }, { status: 400 });
  if (!description) return NextResponse.json({ error: 'Description is required' }, { status: 400 });
  const [{ n }] = await queryAll('SELECT COALESCE(MAX(seq), 0) + 1 AS n FROM installation_visits WHERE project_id = ?', [b.project_id]);
  const { lastId } = await execute(
    `INSERT INTO installation_visits (project_id, seq, description, visit_date, visit_time, visited_by, status, created_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [b.project_id, n, description, b.visit_date || null, b.visit_time || null, b.visited_by || null, b.status === 'done' ? 'done' : 'planned', user.username]
  );
  await audit('installation_visit_added', { actor: user.username, detail: `project ${b.project_id}: ${description}` });
  try { await syncServiceMilestones(Number(b.project_id), user.username); } catch { /* best-effort */ }
  return NextResponse.json({ id: Number(lastId) });
}
