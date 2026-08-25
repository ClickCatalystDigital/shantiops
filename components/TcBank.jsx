'use client';

// Test Certificate bank (/qc) — cross-project, QC-department-gated (Nav.jsx). Two-line list rows,
// not a wide table: 13 chemistry/physical columns won't fit any screen, same reasoning as QcPanel's
// list idiom. Search filters client-side over the whole (small, ~17-row) bank, same pattern as
// ProcurementWorkspace's shared search input.
import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Card, CardContent, CardHeader, CardTitle, CardAction } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { PlusIcon, SearchIcon, ChevronRightIcon, FileTextIcon } from 'lucide-react';
import CertForm from './CertForm';
import PdfPreview from './PdfPreview';

function sizeText(c) {
  return [c.size_t, c.size_w, c.size_l].filter(Boolean).join(' × ') || '—';
}

function CertRow({ c, onClick, onViewPdf }) {
  return (
    <button onClick={onClick} className="flex w-full flex-col gap-1 py-2.5 text-left text-sm hover:bg-muted/50">
      <div className="flex items-center gap-2">
        <span className="font-medium">{c.certificate_no}</span>
        <span className="text-muted-foreground">cast {c.cast_no}</span>
        {c.plate_no && <span className="text-muted-foreground">plate {c.plate_no}</span>}
        {c.pdf_key && (
          <span
            role="button"
            tabIndex={0}
            onClick={e => { e.stopPropagation(); onViewPdf(); }}
            onKeyDown={e => { if (e.key === 'Enter') { e.stopPropagation(); onViewPdf(); } }}
            className="ml-auto flex items-center gap-1 rounded px-1.5 py-0.5 text-xs text-primary hover:bg-primary/10"
          >
            <FileTextIcon className="size-3.5" />PDF
          </span>
        )}
        <ChevronRightIcon className={c.pdf_key ? 'size-4 text-muted-foreground' : 'ml-auto size-4 text-muted-foreground'} />
      </div>
      <p className="text-xs text-muted-foreground">
        {c.material_spec} · {c.steel_maker} · {sizeText(c)}
      </p>
      <p className="text-xs text-muted-foreground">
        C {c.chem_c} Mn {c.chem_mn} P {c.chem_p} S {c.chem_s} Si {c.chem_si}
        {' · '}Y.S {c.ys} UTS {c.uts} El {c.elongation}% · {c.bend_test}
      </p>
      <div className="flex flex-wrap items-center gap-1">
        {c.project_nos
          ? c.project_nos.split('||').map(pn => (
              <span key={pn} className="rounded-full border bg-muted/50 px-1.5 py-0.5 text-[11px] text-foreground/70">{pn}</span>
            ))
          : <span className="text-[11px] text-muted-foreground">Unassigned</span>}
        <span className="ml-auto text-[11px] text-muted-foreground">used in {c.used_in_parts} part{c.used_in_parts === 1 ? '' : 's'}</span>
      </div>
    </button>
  );
}

export default function TcBank({ certificates = [], projects = [], defaultProjectIds = [] }) {
  const router = useRouter();
  const [q, setQ] = useState('');
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [viewingPdf, setViewingPdf] = useState(null);

  const needle = q.trim().toLowerCase();
  const shown = certificates.filter(c => !needle || [
    c.certificate_no, c.cast_no, c.plate_no, c.steel_maker, c.material_spec,
  ].some(v => v?.toLowerCase().includes(needle)));

  return (
    <Card>
      <CardHeader>
        <CardTitle>Test Certificates</CardTitle>
        <CardAction>
          <Button size="sm" variant="outline"
            onClick={() => { setEditing(null); setFormOpen(true); }}>
            <PlusIcon data-icon="inline-start" />Add Certificate
          </Button>
        </CardAction>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <div className="relative">
          <SearchIcon className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input value={q} onChange={e => setQ(e.target.value)} placeholder="Search cert · cast · plate · maker" className="pl-8" />
        </div>
        <p className="text-xs text-muted-foreground">
          {shown.length} of {certificates.length} certificate{certificates.length === 1 ? '' : 's'}
        </p>
        <div className="flex flex-col divide-y">
          {shown.length === 0 && (
            <p className="py-6 text-center text-sm text-muted-foreground">
              {certificates.length === 0
                ? 'No certificates yet — add the first one before filing a statutory document.'
                : 'No matches.'}
            </p>
          )}
          {shown.map(c => (
            <CertRow key={c.id} c={c} onClick={() => { setEditing(c); setFormOpen(true); }} onViewPdf={() => setViewingPdf(c)} />
          ))}
        </div>
      </CardContent>
      <CertForm
        key={editing?.id ?? 'new'}
        open={formOpen}
        onOpenChange={setFormOpen}
        certificate={editing}
        certificates={certificates}
        projects={projects}
        defaultProjectIds={defaultProjectIds}
        router={router}
      />
      {viewingPdf && (
        <PdfPreview
          open={!!viewingPdf}
          onOpenChange={o => !o && setViewingPdf(null)}
          url={`/api/test-certificates/${viewingPdf.id}/pdf`}
          title={`Certificate ${viewingPdf.certificate_no}`}
          filename={`${viewingPdf.certificate_no}.pdf`}
        />
      )}
    </Card>
  );
}
