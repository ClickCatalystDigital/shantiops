'use client';

// The QC workspace (/qc) — Test Certificates + Documents tabs via the shared WorkspaceSidebar. Two
// searchable filters in the header: Series (left) narrows the Project list; Project scopes both tabs.
// Picking a project auto-selects its series. Neither set → everything. Deep-linked from a project's
// QC summary card via ?tab= and ?project=.
import { useMemo, useState } from 'react';
import WorkspaceSidebar from './WorkspaceSidebar';
import TcBank from './TcBank';
import StatutoryDocsPanel from './StatutoryDocsPanel';
import CalibrationPanel from './CalibrationPanel';
import SearchableSelect from './SearchableSelect';
import { QC_SERIES } from '@/lib/qc-series';
import { FlaskConicalIcon, FileTextIcon, GaugeIcon } from 'lucide-react';

const ITEMS = [
  { key: 'tc', label: 'Test Certificates', icon: FlaskConicalIcon },
  { key: 'docs', label: 'Documents', icon: FileTextIcon },
  { key: 'calibration', label: 'Calibration', icon: GaugeIcon },
];

const SERIES_ITEMS = QC_SERIES.map(s => ({ id: s, label: s }));

const certProjectIds = c => (c.project_ids ? String(c.project_ids).split(',').map(Number) : []);

export default function QcWorkspace({ projects = [], certificates = [], documents = [], calibrationItems = [], initialTab, initialProject }) {
  const [tab, setTab] = useState(ITEMS.some(i => i.key === initialTab) ? initialTab : 'tc');

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

  const header = (
    <div className="flex flex-wrap items-center gap-2">
      <SearchableSelect items={SERIES_ITEMS} value={series} onChange={pickSeries}
        allOption={{ label: 'All models' }} triggerPlaceholder="Model" placeholder="Search models…"
        className="w-40" />
      <SearchableSelect items={projectsForSeries} value={projectId} onChange={pickProject}
        allOption={{ label: 'All projects' }} triggerPlaceholder="Project" placeholder="Search projects…"
        getLabel={p => p.project_no} getSub={p => p.customer_name} className="w-64" />
    </div>
  );

  return (
    <WorkspaceSidebar title="Quality Control" icon={FlaskConicalIcon} items={ITEMS}
      activeKey={tab} onChange={setTab} header={tab === 'calibration' ? null : header}>
      {tab === 'tc' ? (
        <TcBank certificates={shownCerts} projects={projectsSorted} defaultProjectIds={projectId != null ? [projectId] : []} />
      ) : tab === 'docs' ? (
        <StatutoryDocsPanel projectId={projectId} documents={shownDocs} canEdit showProject />
      ) : (
        <CalibrationPanel items={calibrationItems} canEdit />
      )}
    </WorkspaceSidebar>
  );
}
