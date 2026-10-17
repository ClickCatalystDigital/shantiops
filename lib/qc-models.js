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
  // IBR 2026: a PRS is a fittings assembly -> Form IV(Part-D) (mountings & fittings, reg 12) plus the
  // material extract Form V(Part-B). IBR 1950 keeps its old Form III + IV A set.
  PRS: { noun: 'Pressure Reducing Station', forms: ['III', 'IVA'], forms2026: ['IVD', 'IVA'] },
  // Real client sample (2026-08-24, maker's no SB-IBR-SH-1100A/B) — a standalone component shipped
  // without a boiler files Form III (component variant) + Form III-H, not Form II(1)/IIIA/IVA.
  // IBR 2026: Form IV(Part-G) (reg 15) refers to the enclosed Form V(Part-B) for raw material, and
  // Form IV(Part-A) is the boiler's own certificate, so a standalone header files IV(G) + V(B).
  HEADERS: { noun: 'Steam Header', forms: ['III', 'IIIH'], forms2026: ['IIIH', 'IVA'] },
  // GF/DF — same config as SF: standard 4-form boiler set, and (lib/qc-folder-pdf.js's own
  // isBigBoiler check) never crosses onto the fixed BIG_BOILER_PARTS list regardless of capacity,
  // i.e. always the "SF under 100 ton" behavior.
  GF: { noun: 'Boiler', forms: ['II1', 'III', 'IIIA', 'IVA'] },
  DF: { noun: 'Boiler', forms: ['II1', 'III', 'IIIA', 'IVA'] },
  AF: { noun: 'Boiler', forms: ['II1', 'III', 'IIIA', 'IVA'] },
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

// `version` = the document's IBR version ('1950' | '2026'); a model with its own 2026 form set uses it.
export function modelConfig(model, version) {
  const cfg = MODEL_CONFIG[model] || { noun: 'Boiler', forms: DEFAULT_FORMS };
  return version === '2026' && cfg.forms2026 ? { ...cfg, forms: cfg.forms2026 } : cfg;
}
