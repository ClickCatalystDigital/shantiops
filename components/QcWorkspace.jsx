'use client';

// The QC workspace (/qc) — Test Certificates + Documents tabs via the shared WorkspaceSidebar. Two
// searchable filters in the header: Series (left) narrows the Project list; Project scopes both tabs.
// Picking a project auto-selects its series. Neither set → everything. Deep-linked from a project's
// QC summary card via ?tab= and ?project=.
import { useMemo, useState } from 'react';
import WorkspaceSidebar from './WorkspaceSidebar';
import TcBank from './TcBank';
import MaterialCertificatePanel from './MaterialCertificatePanel';
import StatutoryDocsPanel from './StatutoryDocsPanel';
import CalibrationPanel from './CalibrationPanel';
import NcrPanel from './NcrPanel';
import QcHoldPanel from './QcHoldPanel';
import SearchableSelect from './SearchableSelect';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { QC_SERIES } from '@/lib/qc-series';
import { FlaskConicalIcon, FileTextIcon, GaugeIcon, AlertTriangleIcon, LockIcon, LinkIcon } from 'lucide-react';

// "Assign to Units" is a sub-tab of Test Certificates, not a new top-level tab — same group/children
// shape ProcurementWorkspace.jsx's own "Suppliers" (Roster/Analysis) nav item already uses. It's
// exception-only (multi-unit split orders), so it doesn't earn a permanent, usually-irrelevant slot
// of its own; it belongs next to the cert bank it operates on, one click deeper.
const ITEMS = [
  {
    key: 'tc', label: 'Test Certificates', icon: FlaskConicalIcon, group: true,
    children: [
      { key: 'tc-bank', label: 'Certificates', icon: FlaskConicalIcon },
      { key: 'tc-assign', label: 'Assign to Units', icon: LinkIcon },
    ],
  },
  { key: 'docs', label: 'Documents', icon: FileTextIcon },
  { key: 'ncr', label: 'NCR', icon: AlertTriangleIcon },
  { key: 'holds', label: 'Hold Points', icon: LockIcon },
  { key: 'calibration', label: 'Calibration', icon: GaugeIcon },
];
const FLAT_TAB_KEYS = ITEMS.flatMap(i => (i.group ? i.children : i)).map(i => i.key);

const SERIES_OPTIONS = [{ value: null, label: 'All models' }, ...QC_SERIES.map(s => ({ value: s, label: s }))];

const certProjectIds = c => (c.project_ids ? String(c.project_ids).split(',').map(Number) : []);

export default function QcWorkspace({ projects = [], certificates = [], documents = [], calibrationItems = [], ncrs = [], holdPoints = [], splitOrders = [], canDisposition = false, canVerify = false, canClose = false, initialTab, initialProject }) {
  const [tab, setTab] = useState(FLAT_TAB_KEYS.includes(initialTab) ? initialTab : 'tc-bank');

  // "Assign to Units" operates on a whole split ORDER, not one unit — its own picker, independent
  // of the Model/Project header the other tabs share (real user feedback: reusing that picker to
  // reach an order via one of its units was confusing, since the panel then shows every unit
  // regardless of which one was picked).
  const [assignOrderId, setAssignOrderId] = useState(null);

  const initProject = initialProject && projects.some(p => String(p.id) === String(initialProject)) ? Number(initialProject) : null;
  const [series, setSeries] = useState(initProject ? (projects.find(p => p.id === initProject)?.series || null) : null);
  const [projectId, setProjectId] = useState(initProject);

  // Newest order first (created_at DESC), optionally narrowed to the selected series.
  const projectsSorted = useMemo(
    () => [...projects].sort((a, b) => String(b.created_at).localeCompare(String(a.created_at))),
    [projects]);
  const projectsForSeries = series ? projectsSorted.filter(p => p.series === series) : projectsSorted;
  const seriesProjectIds = useMemo(() => new Set(projectsForSeries.map(p => p.id)), [projectsForSeries]);

  function pickSeries(s) {
    setSeries(s);
    // Drop a selected project that no longer matches the series.
    if (projectId != null && s && projects.find(p => p.id === projectId)?.series !== s) setProjectId(null);
  }
  function pickProject(id) {
    setProjectId(id);
    if (id != null) setSeries(projects.find(p => p.id === id)?.series || null); // auto-select series
  }

  const shownCerts = projectId != null
    ? certificates.filter(c => certProjectIds(c).includes(projectId))
    : series
      ? certificates.filter(c => certProjectIds(c).some(pid => seriesProjectIds.has(pid)))
      : certificates;
  const shownDocs = projectId != null
    ? documents.filter(d => d.project_id === projectId)
    : series
      ? documents.filter(d => seriesProjectIds.has(d.project_id))
      : documents;
  const shownNcrs = projectId != null
    ? ncrs.filter(n => n.project_id === projectId)
    : series
      ? ncrs.filter(n => seriesProjectIds.has(n.project_id))
      : ncrs;

  const header = (
    <div className="flex flex-wrap items-center gap-2">
      <SearchableSelect options={SERIES_OPTIONS} value={series} onChange={pickSeries}
        placeholder="Search models…" className="w-40" />
      <SearchableSelect
        options={[{ value: null, label: 'All projects' }, ...projectsForSeries.map(p => ({
          value: p.id, label: p.customer_name ? `${p.project_no} — ${p.customer_name}` : p.project_no,
        }))]}
        value={projectId} onChange={pickProject} placeholder="Search projects…" className="w-64" />
    </div>
  );

  const assignHeader = (
    <SearchableSelect
      options={splitOrders.map(o => ({
        value: o.id, label: `${o.project_no} — ${o.customer_name} (${o.unit_count} units)`,
      }))}
      value={assignOrderId} onChange={setAssignOrderId} placeholder="Search split orders…" className="w-96" />
  );

  return (
    <WorkspaceSidebar title="Quality Control" icon={FlaskConicalIcon} items={ITEMS}
      activeKey={tab} onChange={setTab}
      header={tab === 'tc-assign' ? assignHeader : ['calibration', 'holds'].includes(tab) ? null : header}>
      {tab === 'tc-bank' ? (
        <TcBank certificates={shownCerts} projects={projectsSorted} defaultProjectIds={projectId != null ? [projectId] : []} />
      ) : tab === 'tc-assign' ? (
        assignOrderId ? (
          <MaterialCertificatePanel masterProjectId={assignOrderId} certificates={certificates} />
        ) : (
          <Card>
            <CardHeader><CardTitle>Assign certificates to material</CardTitle></CardHeader>
            <CardContent>
              <p className="text-sm text-muted-foreground">
                {splitOrders.length
                  ? 'Pick a split order above — every unit of that order shows up below at once.'
                  : 'No multi-unit split orders exist right now — this tab only applies to those.'}
              </p>
            </CardContent>
          </Card>
        )
      ) : tab === 'docs' ? (
        <StatutoryDocsPanel projectId={projectId} documents={shownDocs} canEdit showProject
          projectSeries={projects.find(p => p.id === projectId)?.series} />
      ) : tab === 'ncr' ? (
        <NcrPanel ncrs={shownNcrs} canDisposition={canDisposition} canVerify={canVerify} canClose={canClose} />
      ) : tab === 'holds' ? (
        <QcHoldPanel holdPoints={holdPoints} />
      ) : (
        <CalibrationPanel items={calibrationItems} canEdit />
      )}
    </WorkspaceSidebar>
  );
}
