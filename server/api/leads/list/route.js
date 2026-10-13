// The Enquiries list, board and helpers, one page at a time (lib/lead-list.mjs). The page no longer
// carries all 5,000+ enquiries; SalesWorkspace's LeadsTab asks this route for what it shows.
//   ?mode=list&stage=&source=&branch=&unassigned=1&amc=1&search=&group=1&offset=&limit=
//   ?mode=ids  (same filters) -> every matching id, for "select all"
//   ?mode=board (same filters) [&stage_more=<name>&offset=]
//   ?mode=related&id=<lead id>      ?mode=hints&org=<organization name>
import { NextResponse } from 'next/server';
import { queryAll } from '@/lib/db';
import { getFreshSessionUser, canAccessDepartment } from '@/lib/auth';
import { salesScope } from '@/lib/sales-visibility';
import { leadVisible } from '@/lib/sales-visibility.mjs';
import { LEAD_LIST_FIELDS, slimLead } from '@/lib/sales-tab-data.mjs';
import { filterLeads, leadsPage, leadBoard, relatedLeads, enquiryFormHints } from '@/lib/lead-list.mjs';
import { getSalesStages } from '@/lib/data';

const SCOPE_FIELDS = ['initiated_by', 'created_by']; // read by leadVisible, never sent

export async function GET(req) {
  const user = await getFreshSessionUser();
  if (!['Sales', 'Marketing'].some((d) => canAccessDepartment(user, d))) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  const sp = new URL(req.url).searchParams;
  const cols = [...LEAD_LIST_FIELDS, ...SCOPE_FIELDS].join(', ');
  let leads = await queryAll(`SELECT ${cols} FROM leads ORDER BY created_at DESC`);
  const me = salesScope(user); // a Sales member sees only their own enquiries
  if (me) leads = leads.filter((l) => leadVisible(l, me));
  leads = leads.map(slimLead);

  const f = {
    stage: sp.get('stage') || 'all', source: sp.get('source') || 'all', branch: sp.get('branch') || 'all',
    unassigned: sp.get('unassigned') === '1', amc: sp.get('amc') === '1',
    search: sp.get('search') || '', group: sp.get('group') === '1',
  };
  const int = (k, d, max) => Math.min(max, Math.max(0, Number.parseInt(sp.get(k), 10) || d));
  const mode = sp.get('mode') || 'list';

  if (mode === 'list') return NextResponse.json(leadsPage(leads, f, int('offset', 0, 1e6), int('limit', 25, 200)));
  if (mode === 'ids') return NextResponse.json({ ids: filterLeads(leads, f).map((l) => l.id) });
  if (mode === 'board') {
    const stages = await getSalesStages();
    const more = sp.get('stage_more') ? { stage: sp.get('stage_more'), offset: int('offset', 0, 1e6) } : null;
    if (more) return NextResponse.json(leadBoard(leads, f, stages, 40, more));
    const { rows, total, ...facts } = leadsPage(leads, f, 0, 0); // toolbar facts, same as the list's
    return NextResponse.json({ ...leadBoard(leads, f, stages, 40), ...facts });
  }
  if (mode === 'related') {
    const lead = leads.find((l) => l.id === Number(sp.get('id')));
    const all = lead ? relatedLeads(leads, lead) : [];
    return NextResponse.json({ rows: all.slice(0, 10), total: all.length });
  }
  if (mode === 'hints') return NextResponse.json(enquiryFormHints(leads, sp.get('org') || ''));
  return NextResponse.json({ error: 'Unknown mode' }, { status: 400 });
}
