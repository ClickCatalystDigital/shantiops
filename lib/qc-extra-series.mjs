// "Extra documentation" a QC project can carry next to its main Form set: a standalone component
// filing (HEADERS, PRS, FAB, FCB) detected from the BOM tree, plus SIB (a project flag, not a
// category). A document whose own series is one of these keeps that series; every other document
// still follows the project's model — old documents carry a legacy 'SF' default that isn't authoritative.
export const EXTRA_DOC_SERIES = ['HEADERS', 'PRS', 'FAB', 'FCB'];
const OWN_SERIES = new Set([...EXTRA_DOC_SERIES, 'SIB']);

export function docSeries(doc, project) {
  return OWN_SERIES.has(doc?.series) ? doc.series : (project?.series || doc?.series);
}

// Which extras a list of BOM names (assembly names / PMB sheet names) points at. ponytail: name
// match only — "Steam Pipe Line (upto Header)" is skipped, anything else odd is one click to untick.
const RULES = {
  HEADERS: n => /\bheaders?\b/i.test(n) && !/pipe\s*line/i.test(n),
  PRS: n => /\bprs\b|pressure\s*reduc/i.test(n),
  FAB: n => /\bfab\b/i.test(n),
  FCB: n => /\bfcb\b/i.test(n),
};
export function extraSeriesFromNames(names) {
  return EXTRA_DOC_SERIES.filter(s => names.some(n => n && RULES[s](String(n))));
}
