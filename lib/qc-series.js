// The boiler-documentation series (client-confirmed 2026-08-16). A project belongs to exactly one
// series, set at project creation, and it drives the project number's prefix. Order kept as the
// client listed them.
export const QC_SERIES = ['CF', 'MF', 'OF', 'SF', 'SIB', 'PRS', 'FCB', 'FAB', 'HEADERS'];

export function isValidSeries(s) {
  return QC_SERIES.includes(s);
}
