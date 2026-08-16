// Per-model folder config (QC-FOLDER-DESIGN.md §3). `noun` = product word used in the covering
// letter; `forms` = the ordered statutory forms this model's folder contains. Only models with a real
// sample are configured; FCB/FAB have no sample yet and HEADERS isn't in the selectable model list —
// unknown models fall back to DEFAULT_FORMS (the four-form boiler set) and noun 'Boiler'.
export const MODEL_CONFIG = {
  CF:  { noun: 'Boiler', forms: ['II1', 'III', 'IIIA', 'IVA'] },
  MF:  { noun: 'Boiler', forms: ['II1', 'III', 'IIIA', 'IVA'] },
  OF:  { noun: 'Boiler', forms: ['II1', 'III', 'IIIA', 'IVA'] },
  SF:  { noun: 'Boiler', forms: ['II1', 'III', 'IIIA', 'IVA'] },
  SIB: { noun: 'Boiler', forms: ['XVII', 'IIIA', 'IVA'] },
  PRS: { noun: 'Pressure Reducing Station', forms: ['III', 'IVA'] },
};

export const DEFAULT_FORMS = ['II1', 'III', 'IIIA', 'IVA'];

export const FORM_LABELS = {
  II1: 'Form II(1)', XVII: 'Form XVII', III: 'Form III', IIIA: 'Form III A', IVA: 'Form IV A',
};

export function modelConfig(model) {
  return MODEL_CONFIG[model] || { noun: 'Boiler', forms: DEFAULT_FORMS };
}
