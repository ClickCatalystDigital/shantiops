import { NextResponse } from 'next/server';
import { nextNumber, createProjectMilestones, withTransaction, queryOne } from '@/lib/db';
import { getFreshSessionUser, isDesignHead, isCustomer, canAccessProject } from '@/lib/auth';
import { getActiveProjectsList } from '@/lib/data';
import { isValidSeries } from '@/lib/qc-series';
import { audit } from '@/lib/usb';
import { notifyDepartment, notifyPMs } from '@/lib/notify';
import { COMPANY_NAMES } from '@/lib/qc-doc-pdf.js';

// In-place Calc Sheets project switcher (CalcWorkspace sidebar) — same list app/calc/page.js's
// picker uses, just as a client-side fetch instead of a server component prop.
export async function GET() {
  const user = await getFreshSessionUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  // The picker is used by internal workspaces. Customers must only ever see their own
  // project IDs, even when they call this API directly instead of through the portal UI.
  const projects = isCustomer(user)
    ? (await getActiveProjectsList()).filter(p => canAccessProject(user, p.id))
    : await getActiveProjectsList();
  return NextResponse.json({ projects });
}

export async function POST(req) {
  const user = await getFreshSessionUser();
  // Project creation is PM tier, plus Design head so Sales' SO→Project handoff (STORES-SALES-
  // CHANGES.md §2b) doesn't require an out-of-band ask to a PM (isDesignHead already covers isPM).
  if (!isDesignHead(user)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  const b = await req.json();
  if (!b.customer_name?.trim()) {
    return NextResponse.json({ error: 'Customer name is required' }, { status: 400 });
  }
  // series = the equipment model (lib/qc-series.js), a stored attribute used for filtering. It sits in
  // a fixed mid-segment of the real project code (e.g. STF-IBR-045-CF-400-15), NOT a prefix, and the
  // full code's segments aren't formalized yet — so the number stays manual / the legacy SB counter,
  // not derived from the model.
  const series = isValidSeries(b.series) ? b.series : null;
  const project_no = b.project_no?.trim() || (await nextNumber('project_no', 'SB'));
  // Which legal entity — decided at the Sale Order (the commercial commitment), not here, when one
  // exists: copy it onto the project. Only a project created without going through Sales falls
  // back to a manual company field on this form.
  let company = COMPANY_NAMES[0];
  if (b.sale_order_id) {
    const so = await queryOne('SELECT company FROM sale_orders WHERE id = ?', [b.sale_order_id]);
    if (so?.company) company = so.company;
  } else if (COMPANY_NAMES.includes(b.company)) {
    company = b.company;
  }
  try {
    // customer_id/sale_order_id — V3_CHANGES.md §12 Phase 2f, the Lead→Customer→Quotation→Sale
    // Order→Project chain's final link. Both additive/nullable; customer_name stays NOT NULL and
    // required exactly as before, so the 6 pre-existing free-text-only projects are unaffected.
    const { projectId, sosTitle } = await withTransaction(async tx => {
      const r = await tx.execute({
        sql: `INSERT INTO projects (project_no, customer_name, description, order_date, owner, customer_id, sale_order_id, series, company)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        args: [project_no, b.customer_name.trim(), b.description || null, b.order_date || null, user?.username || null,
          b.customer_id || null, b.sale_order_id || null, series, company],
      });
      const id = Number(r.lastInsertRowid);
      // Project, milestones, and the initial Scope of Supply are one business operation. If any
      // step fails, none of them remains as a misleading partial project.
      const todayStr = new Date().toISOString().slice(0, 10);
      const start = b.order_date && b.order_date > todayStr ? new Date(b.order_date) : new Date();
      const startDaysAgo = Math.round((Date.now() - start.getTime()) / 864e5);
      await createProjectMilestones(tx, id, startDaysAgo, false);

      let title = null;
      if (b.sale_order_id) {
        const so = await tx.execute({ sql: 'SELECT so_no FROM sale_orders WHERE id = ?', args: [b.sale_order_id] });
        title = so.rows.length ? `Scope of Supply — ${so.rows[0].so_no}` : 'Scope of Supply';
        await tx.execute({
          sql: 'INSERT INTO scope_of_supply (project_id, title, created_by) VALUES (?, ?, ?)',
          args: [id, title, user?.username || null],
        });
      }
      return { projectId: id, sosTitle: title };
    });

    // Notifications and audit are intentionally outside the transaction: they are best-effort
    // side effects and must never hold a database write transaction open over network work.
    if (sosTitle) {
      try {
        const note = {
          kind: 'sos_created',
          title: 'New Scope of Supply',
          body: `${project_no} · ${sosTitle}`,
          dedupe_key: `sos_created:${projectId}`,
        };
        await notifyDepartment('Design', note);
        await notifyDepartment('Engineering', note);
        // The Sales→PM handoff (STORES-SALES-CHANGES.md §2b): a Design head converting a Sale
        // Order to a Project is the event Sales and PMs actually need to hear about — Design
        // already knows, they did it.
        const convertNote = { kind: 'project_created', title: `Project created from Sale Order`, body: `${project_no} · ${sosTitle}`, dedupe_key: `so_converted:${projectId}` };
        await notifyDepartment('Sales', convertNote);
        await notifyPMs(convertNote, { except: user.id });
      } catch (err) { /* notification is best-effort */ }
    }

    await audit('project_created', { actor: user.username, detail: `${project_no} · ${b.customer_name.trim()}` });
    return NextResponse.json({ id: projectId, project_no });
  } catch (e) {
    if (String(e).includes('UNIQUE')) {
      return NextResponse.json({ error: `Project ${project_no} already exists` }, { status: 409 });
    }
    throw e;
  }
}
