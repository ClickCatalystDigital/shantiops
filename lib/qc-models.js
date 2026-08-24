// Per-model folder config (QC-FOLDER-DESIGN.md §3). `noun` = product word used in the covering
// letter; `forms` = the ordered statutory forms this model's folder contains. Only models with a real
// sample are configured; FCB/FAB have no sample yet — unknown models fall back to DEFAULT_FORMS (the
// four-form boiler set) and noun 'Boiler'.
export const MODEL_CONFIG = {
  CF:  { noun: 'Boiler', forms: ['II1', 'III', 'IIIA', 'IVA'] },
  MF:  { noun: 'Boiler', forms: ['II1', 'III', 'IIIA', 'IVA'] },
  OF:  { noun: 'Boiler', forms: ['II1', 'III', 'IIIA', 'IVA'] },
  SF:  { noun: 'Boiler', forms: ['II1', 'III', 'IIIA', 'IVA'] },
  SIB: { noun: 'Boiler', forms: ['XVII', 'IIIA', 'IVA'] },
  PRS: { noun: 'Pressure Reducing Station', forms: ['III', 'IVA'] },
  // Real client sample (2026-08-24, maker's no SB-IBR-SH-1100A/B) — a standalone component shipped
  // without a boiler files Form III (component variant) + Form III-H, not Form II(1)/IIIA/IVA.
  HEADERS: { noun: 'Steam Header', forms: ['III', 'IIIH'] },
};

export const DEFAULT_FORMS = ['II1', 'III', 'IIIA', 'IVA'];

export const FORM_LABELS = {
  II1: 'Form II(1)', XVII: 'Form XVII', III: 'Form III', IIIA: 'Form III A', IVA: 'Form IV A',
  IIIH: 'Form III-H',
};

// doc_id/maker's-no auto-suggest abbreviation — distinct from the internal QC_SERIES value where the
// real filed convention doesn't match it 1:1 (client's real numbers use SB-IBR-SH-1100A, "SH", not
// "HEADERS"). Falls back to the series value itself for every model where they're already the same.
export const SERIES_DOC_ABBR = { HEADERS: 'SH' };
export function docIdAbbr(series) { return SERIES_DOC_ABBR[series] || series; }

export function modelConfig(model) {
  return MODEL_CONFIG[model] || { noun: 'Boiler', forms: DEFAULT_FORMS };
}
