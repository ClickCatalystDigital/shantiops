// Shared status-filter definitions for the milestone Operations pills (OperationsAttentionSection,
// DesignOperationsSection). Single source of truth — these were previously copy-pasted verbatim
// between the two files.
export const MILESTONE_FILTER_DEFS = [
  { key: 'overdue', label: 'overdue', dot: 'bg-danger', match: code => code === 'overdue' },
  { key: 'blocked', label: 'blocked', dot: 'bg-blocked', match: code => code === 'blocked' },
  { key: 'dueSoon', label: 'due soon', dot: 'bg-warning', match: code => code === 'due_now' || code === 'due_soon' },
];