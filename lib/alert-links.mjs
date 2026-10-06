// Where an alert should open (bell, notifications page and the email link). Pure.
// tabLink: any workspace tab (lib/workspace-routes.js); `highlight` scrolls to and flashes the row
// carrying that data-entity-code (handled once in components/WorkspaceSidebar.jsx), `q` pre-fills the
// tab's search where the tab reads it. Procurement also reads view / project.
//   node lib/alert-links.mjs
const qs = o => new URLSearchParams(Object.entries(o).filter(([, v]) => v != null && v !== '')).toString();
const withQs = (path, params = {}) => { const q = qs(params); return q ? `${path}?${q}` : path; };

// A drawing on the Drawings page (project picked, card flashed).
export const drawingLink = d => withQs('/calc-drawings', { project: d.project_id, highlight: d.dg_no });

export const tabLink = (base, tab, params) => withQs(`${base}/${String(tab).replace(/_/g, '-')}`, params);

export const enquiryForProject = projectNo => `/procurement/enquiry?${qs({ view: 'pmb', project: projectNo })}`;
export const enquiryForPr = prNo => `/procurement/enquiry?${qs({ view: 'pr', q: prNo })}`;

// One BOM line in Selection: PR lines under PR Items (filtered to the PR), Procurement's own custom
// items under Custom Items, everything else under PMB Items for its project. highlight scrolls to it.
export function selectionForItem(it) {
  const hl = `BM-${it.id}`;
  if (it.pr_item_id) return `/procurement/selection?${qs({ view: 'pr', q: it.pr_no, highlight: hl })}`;
  if (it.source === 'custom') return `/procurement/selection?${qs({ view: 'custom', highlight: hl })}`;
  return `/procurement/selection?${qs({ view: 'pmb', project: it.project_is_system ? null : it.project_no, highlight: hl })}`;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const eq = (a, b) => { if (a !== b) throw new Error(`${a} != ${b}`); };
  eq(enquiryForProject('SB-1060'), '/procurement/enquiry?view=pmb&project=SB-1060');
  eq(enquiryForPr('PR-74'), '/procurement/enquiry?view=pr&q=PR-74');
  eq(selectionForItem({ id: 9, pr_item_id: 3, pr_no: 'PR-74' }), '/procurement/selection?view=pr&q=PR-74&highlight=BM-9');
  eq(selectionForItem({ id: 9, source: 'custom' }), '/procurement/selection?view=custom&highlight=BM-9');
  eq(selectionForItem({ id: 9, source: 'bom', project_no: 'STF-IBR-060' }), '/procurement/selection?view=pmb&project=STF-IBR-060&highlight=BM-9');
  eq(selectionForItem({ id: 9, source: 'stock', project_no: '—', project_is_system: 1 }), '/procurement/selection?view=pmb&highlight=BM-9');
  eq(tabLink('/stores', 'indents', { highlight: 'MI-7' }), '/stores/indents?highlight=MI-7');
  eq(tabLink('/sales', 'sale_orders', { highlight: 'SO-3', q: '' }), '/sales/sale-orders?highlight=SO-3');
  eq(tabLink('/qc', 'ncr'), '/qc/ncr');
  eq(drawingLink({ project_id: 4, dg_no: 'DG-1003' }), '/calc-drawings?project=4&highlight=DG-1003');
  console.log('alert-links ok');
}
