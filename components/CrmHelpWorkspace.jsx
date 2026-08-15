'use client';

// Compatibility wrapper for older imports. The shared department workspace is now the
// source of truth for Sales and Marketing help, including department-specific headings.
import DepartmentHelpWorkspace from '@/components/DepartmentHelpWorkspace';

export default function CrmHelpWorkspace({ departments = ['Sales', 'Marketing'] }) {
  return <DepartmentHelpWorkspace departments={departments} />;
}
