// Small status pill shared by the portal (customer) and Design views of a customer-uploaded drawing.
import { cn } from '@/lib/utils';

export const UPLOAD_STATUS = {
  submitted: { label: 'Submitted', cls: 'bg-muted text-muted-foreground' },
  reviewed: { label: 'Reviewed', cls: 'bg-success/10 text-success' },
  needs_changes: { label: 'Needs changes', cls: 'bg-warning/15 text-warning' },
};

export function UploadStatusPill({ status }) {
  const s = UPLOAD_STATUS[status] || UPLOAD_STATUS.submitted;
  return <span className={cn('inline-flex shrink-0 items-center rounded-full px-2 py-0.5 text-xs font-medium', s.cls)}>{s.label}</span>;
}

export const fileSize = (n) => n == null ? '' : n < 1024 * 1024 ? `${Math.max(1, Math.round(n / 1024))} KB` : `${(n / 1024 / 1024).toFixed(1)} MB`;
