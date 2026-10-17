// lib/qc-ibr.mjs — which Indian Boiler Regulations a QC statutory document is filed under, and the
// printed form numbers / citations for each. Pure (no imports), used by the folder PDF, the editor
// and the documents list. Source for every 2026 string: Gazette of India Extraordinary No. 596,
// 1 Oct 2026 (Indian Boiler Regulations, 2026) — see docs/ibr-2026-forms.md. The 1950 strings are
// exactly what lib/qc-folder-pdf.js printed before versions existed, so a 1950 document reprints
// unchanged.
// Under 2026 the folder prints separate pages built from the gazette layouts (lib/qc-folder-pdf.js,
// "IBR 2026 pages"); 1950 pages are never changed.

export const IBR_VERSIONS = ['2026', '1950'];
export const DEFAULT_NEW_IBR = '2026';

// Stored value: '2026' or anything else (incl. NULL on documents made before versions existed) = 1950.
// `series` kept so callers needn't change if a model ever gets held on one version again.
export function ibrVersion(doc, series) { // eslint-disable-line no-unused-vars
  return doc?.ibr_version === '2026' ? '2026' : '1950';
}

const LABELS = {
  1950: { II1: 'Form II(1)', XVII: 'Form XVII', III: 'Form III', IIIA: 'Form III A', IVA: 'Form IV A', IIIH: 'Form III-H' },
  2026: { II1: 'Form I(Part-B)', XVII: 'Form XXII', III: 'Form IV(Part-A)', IIIA: 'Form IV(Part-B)', IVA: 'Form V(Part-B)', IIIH: 'Form IV(Part-G)', IVD: 'Form IV(Part-D)' },
};
export function formLabel(key, version = '1950') {
  return LABELS[version === '2026' ? 2026 : 1950][key] || key;
}

const T1950 = {
  v: '1950',
  rev: {},                                     // no revision line on 1950 pages
  act1923: 'boilers Act, 1923',                // Form II(1) wording, lower case as in the sample
  ii1Title: 'FORM – II (1)', ii1Cite: '[REGULATION 4 (C) (i)]', ii1FormIII: 'Form III',
  xviiTitle: 'FORM XVII — CERTIFICATE OF MANUFACTURE AND TEST FOR SMALL INDUSTRIAL BOILERS',
  iiiTitle: 'FORM III', iiiCompTitle: "FORM III — CONSTRUCTOR'S CERTIFICATE OF MANUFACTURE AND TEST",
  iiiContd: 'FORM III Contd.', iiiSub: 'CONSTRUCTION CERTIFICATES OF MANUFACTURE AND TEST', iiiCite: '(REGULATION 4 (C) II)',
  iiiChapters: 'chapter III / V / X / XII / XIV of the Indian Boiler Regulations.',
  mountingsForm: "Mountings' Form III C are enclosed", svCite: '(Regulation 4(c)(vii))',
  iii9: 'The boiler has been designed and constructed to comply with the regulations under the Indian Boilers Act, 1923 for a Working Pressure of ',
  iiihTitle: 'FORM III-H', iiihTcRef: 'Form IV-A', iiihRegs: 'Indian Boiler Regulations', iiihRegsSigned: 'Indian Boiler Regulations, 1950',
  ivaTitle: 'FORM – IV A', ivaCite: 'REGULATION 4 (c) (IV)', ivaSteelForm: 'Form IV',
  iiiaTitle: 'FORM III A', iiiaSub: 'Certificate of manufacture and Test', iiiaCite: 'Regulations 4(e)', iiiaRegs: 'Indian Boiler Regulations',
};

const T2026 = {
  v: '2026',
  rev: { II1: 'Form I(B):R01 Dated: 07.08.2026', XVII: 'Form XXII:R01 Dated: 07.08.2026', III: 'Form IV(A):R01 Dated: 07.08.2026',
    IIIA: 'Form IV(B):R01 Dated: 07.08.2026', IVA: 'Form V(B):R01 Dated: 07.08.2026', IIIH: 'Form IV(G):R01 Dated: 07.08.2026',
    IVD: 'Form IV(D):R01 Dated: 07.08.2026' },
  act1923: 'Boilers Act, 2025',
  ii1Title: 'FORM-I (PART-B)', ii1Cite: '[See regulation 8(a)]', ii1FormIII: 'Form-IV(Part-A)',
  xviiTitle: 'FORM-XXII — CERTIFICATE OF MANUFACTURE AND TEST FOR SMALL INDUSTRIAL BOILERS [Regulation 555(2)]',
  iiiTitle: 'FORM-IV (PART-A)', iiiCompTitle: "FORM-IV (PART-A) — CONSTRUCTOR'S CERTIFICATE OF MANUFACTURE AND TEST",
  iiiContd: 'FORM-IV (PART-A) Contd.', iiiSub: "CONSTRUCTOR'S CERTIFICATE OF MANUFACTURE AND TEST", iiiCite: '[See regulation 8(b)]',
  iiiChapters: 'Chapter 3/4/10/12/14/16/17 of the Indian Boiler Regulations.',
  mountingsForm: "Mountings' Form-IV(Part-D) are enclosed", svCite: '{Regulation 8(d)(vii)}',
  iii9: 'The boiler has been designed and constructed to comply with the regulations under the Boilers Act, 2025, for a Design pressure of ',
  iiihTitle: 'FORM-IV (PART-G)', iiihTcRef: 'Form-V(Part-B)', iiihRegs: 'Indian Boiler Regulations, 2026', iiihRegsSigned: 'Indian Boiler Regulations, 2026',
  ivaTitle: 'FORM-V (PART-B)', ivaCite: '[Regulation 8(d)]', ivaSteelForm: 'Form-V(Part-A)',
  iiiaTitle: 'FORM-IV (PART-B)', iiiaSub: 'Certificate of manufacture and test for pipes', iiiaCite: '[See regulation 10]', iiiaRegs: 'Indian Boiler Regulations, 2026',
};

export const ibrText = version => (version === '2026' ? T2026 : T1950);

// Belt rows to pre-fill on a new document: 2 belts at 1 TPH (1000 kg/hr) and above, else 1.
// Only a suggestion — the real count comes from the shell drawing and QC edits it.
export function suggestedBeltCount(capacityKgHr) {
  const n = parseFloat(capacityKgHr);
  return Number.isFinite(n) && n >= 1000 ? 2 : 1;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const assert = (c, m) => { if (!c) throw new Error(m); };
  assert(ibrVersion({ ibr_version: '2026' }, 'SF') === '2026', '2026 doc');
  assert(ibrVersion({ ibr_version: null }, 'SF') === '1950', 'old doc = 1950');
  assert(ibrVersion({ ibr_version: '2026' }, 'PRS') === '2026', 'PRS follows the document');
  assert(formLabel('IVD', '2026') === 'Form IV(Part-D)', 'PRS fittings form');
  assert(formLabel('IVA', '2026') === 'Form V(Part-B)' && formLabel('IVA', '1950') === 'Form IV A', 'labels');
  assert(formLabel('XVII', '2026') === 'Form XXII', 'SIB');
  assert(suggestedBeltCount('1000') === 2 && suggestedBeltCount(350) === 1 && suggestedBeltCount('') === 1, 'belts');
  console.log('qc-ibr ok');
}
