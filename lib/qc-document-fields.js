// lib/qc-document-fields.js — single source of truth for qc_documents' header fields, shared by
// the creation sheet (components/StatutoryDocsPanel.jsx) and the edit sheet
// (components/QcDocumentEditor.jsx) via components/QcHeaderField.jsx. Was two independently
// hand-rolled field lists that had already drifted (the creation sheet never showed
// working_pressure/drawing_no_from/drawing_no_to at all) — one list now, both sheets render off it.
//
// `required` reflects a real gap assessment against the actual filed forms (FOLDER SAMPLE - FOR APP,
// CF series Form II(1)/Form III sheets, 2026-08-25), not a guess: every required field here appears
// directly on the certificate text. The 5 non-required fields are covering-letter/label-only
// (QC-FOLDER-DESIGN.md §4.1/§4.3) and don't appear on Form II(1)/III itself.
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
  { key: 'drawing_no', label: 'Drawing No.', required: true, kind: 'text' },
  { key: 'drawing_no_from', label: 'Drawing No. From', required: true, kind: 'text' },
  { key: 'drawing_no_to', label: 'Drawing No. To', required: true, kind: 'text' },
  { key: 'doc_id', label: 'Document ID', required: true, kind: 'text' },
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
