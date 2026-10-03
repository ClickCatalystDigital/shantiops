// The boiler-documentation series (client-confirmed 2026-08-16). A project belongs to exactly one
// series, set at project creation, and it drives the project number's prefix. Order kept as the
// client listed them. SIB is no longer a category — it's the is_sib checkbox on the project.
export const QC_SERIES = ['CF', 'MF', 'OF', 'SF', 'PRS', 'FCB', 'FAB', 'HEADERS', 'GF', 'DF', 'AF'];

export function isValidSeries(s) {
  return QC_SERIES.includes(s);
}
