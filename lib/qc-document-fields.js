// lib/qc-document-fields.js — single source of truth for qc_documents' header fields, shared by
// the creation sheet (components/StatutoryDocsPanel.jsx) and the edit sheet
// (components/QcDocumentEditor.jsx) via components/QcHeaderField.jsx. Was two independently
// hand-rolled field lists that had already drifted (the creation sheet never showed
// working_pressure at all) — one list now, both sheets render off it.
//
// `required` reflects a real gap assessment against the actual filed forms (FOLDER SAMPLE - FOR APP,
// CF series Form II(1)/Form III sheets, 2026-08-25), not a guess: every required field here appears
// directly on the certificate text. The 5 non-required fields are covering-letter/label-only
// (QC-FOLDER-DESIGN.md §4.1/§4.3) and don't appear on Form II(1)/III itself.
//
// drawing_no/drawing_no_from/drawing_no_to used to live here as free-text required fields —
// removed (DG- reversal round) now that the printed "Drawing No's" line is derived, not typed:
// every approved calc_drawings.dg_no on the document's own project (lib/data.js's
// getQcDocumentDetail, document.approved_drawing_codes). Design owns drawing approval, so QC gets
// no manual override point here — see BoilerDetailsSheet's read-only display in
// QcDocumentEditor.jsx instead of a form field.
//
// `kind` drives which control QcHeaderField renders: 'text' | 'number' | 'dimension' | 'date' |
// 'select'. `unit`, for 'number' fields, is a fixed suffix shown next to the input (no conversion —
// every real sample uses the same unit for a given field) — composed into the stored string on
// save, same "canonical display string in, decomposed UI, composed string out" idiom
// components/QtyInput.jsx already uses for qty_text.
export const QC_HEADER_FIELDS = [
  { key: 'company', label: 'Company', required: true, kind: 'select' },
  { key: 'makers_no', label: "Maker's No.", required: true, kind: 'text' },
  { key: 'year_of_make', label: 'Year of Make', required: true, kind: 'number' },
  { key: 'design_pressure', label: 'Design Pressure', required: true, kind: 'number', unit: 'Kg/cm²' },
  { key: 'hydro_test_pressure', label: 'Hydro Test Pressure', required: true, kind: 'number', unit: 'Kg/cm²' },
  { key: 'hydro_test_date', label: 'Hydro Test Date', required: true, kind: 'date' },
  { key: 'working_pressure', label: 'Working Pressure', required: true, kind: 'number', unit: 'Kg/cm²' },
  { key: 'boiler_type', label: 'Boiler Type', required: true, kind: 'text' },
  { key: 'length_overall', label: 'Length Overall', required: true, kind: 'dimension' },
  { key: 'internal_diameter', label: 'Internal Dia', required: true, kind: 'dimension' },
  { key: 'heating_surface', label: 'Heating Surface', required: true, kind: 'number', unit: 'm²' },
  { key: 'evaporation_capacity', label: 'Evaporation Cap.', required: true, kind: 'number', unit: 'Kg/hr — From & at 100°C' },
  { key: 'steam_temp', label: 'Steam Outlet Temp.', required: true, kind: 'number', unit: '°C' },
  { key: 'doc_id', label: 'Document ID', required: true, kind: 'text' },
  // Form III §4/§9 construction facts (QC statutory-forms plan, Phase 5) — free text, matching the
  // real sample's own ONE/TWO/NA-style answers, not assumed numeric. Longitudinal seam counts
  // (per-belt/per-ring) are handled separately, as repeatable rows — see SeamsSection in
  // components/QcDocumentEditor.jsx and app/api/qc-documents/[id]/seams. None of the six below are
  // required — same "honest — when blank" discipline as the Phase 1 fix that preceded this.
  { key: 'circumferential_seams_shell', label: 'Circumferential Seams (Shell/Drum)', required: false, kind: 'text' },
  { key: 'circumferential_seams_furnace', label: 'Circumferential Seams (Furnace)', required: false, kind: 'text' },
  { key: 'construction_repair_details', label: 'Repair Details During Construction', required: false, kind: 'text' },
  // Named distinctly from qc_iiia_groups' own separate, per-Form-III-A-group heat_treatment column —
  // this one is a whole-document construction fact, never to be confused with that narrower concept.
  { key: 'construction_heat_treatment_note', label: 'Construction Heat Treatment', required: false, kind: 'text' },
  { key: 'least_pressure_component_name', label: 'Least Pressure — Governing Component', required: false, kind: 'text' },
  { key: 'least_pressure_value', label: 'Least Pressure — Value', required: false, kind: 'text' },
  // Form III §3/§5/§6 — were hardcoded "Not Applicable" in the PDF generator for every document,
  // regardless of boiler design; real per-document fields now. Blank still prints "Not Applicable"
  // on the PDF (correct for every fire-tube/shell boiler on file today), but QC can now say
  // otherwise for a design that genuinely has drums, header boxes, or outside-manufactured parts.
  { key: 'parts_outside_constructor_works', label: 'Parts Manufactured Outside Constructor\'s Works', required: false, kind: 'text' },
  { key: 'drums_details', label: 'Details of Drums', required: false, kind: 'text' },
  { key: 'headers_boxes_details', label: 'Headers and Boxes', required: false, kind: 'text' },
  // Covering-letter / label fields (QC-FOLDER-DESIGN.md §4.1/§4.3) — not on Form II(1)/III itself.
  { key: 'label_model_code', label: 'Label Model Code', required: false, kind: 'text' },
  { key: 'submission_date', label: 'Submission Date', required: false, kind: 'date' },
  { key: 'signer_name', label: 'Signed By (QC)', required: false, kind: 'text' },
  { key: 'recipient_name', label: 'Recipient (blank = Director)', required: false, kind: 'text' },
  { key: 'recipient_address', label: 'Recipient Address', required: false, kind: 'text' },
];

// The creation sheet only shows the required core (matches today's behavior — the 5 covering-letter
// fields stay edit-only, filled in later once the document exists).
export const CORE_FIELDS = QC_HEADER_FIELDS.filter(f => f.required);
