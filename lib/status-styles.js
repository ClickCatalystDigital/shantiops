// Shared badge-tone classes. Every status/type map in the app (Calc's STATUS_STYLE/TYPE_STYLE,
// Design's SHEET_STATUS_STYLE/DRAWING_STATUS_STYLE, etc.) should build its `cls` from this instead
// of hand-typing the ring/bg/text triplet per tone — that's what let one map (DRAWING_STATUS_LABEL)
// end up with no color at all while its siblings did.
export const TONE_CLASS = {
  info: 'text-info bg-info/10 ring-1 ring-inset ring-info/20',
  success: 'text-success bg-success/10 ring-1 ring-inset ring-success/20',
  warning: 'text-warning bg-warning/10 ring-1 ring-inset ring-warning/20',
  danger: 'text-danger bg-danger/10 ring-1 ring-inset ring-danger/20',
  destructive: 'text-destructive bg-destructive/10 ring-1 ring-inset ring-destructive/20',
  neutral: 'text-muted-foreground bg-muted ring-1 ring-inset ring-border',
};