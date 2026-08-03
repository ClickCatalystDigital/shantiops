// Test Certificate bank (QC-CHANGES.md) — cross-project, same shape as app/procurement/page.js:
// a department-gated top-level route rendering one client workspace component.
import { redirect } from 'next/navigation';
import { getSessionUser, canAccessDepartment, roleHome } from '@/lib/auth';
import { getTestCertificates } from '@/lib/data';
import PageHeader from '@/components/PageHeader';
import TcBank from '@/components/TcBank';

export const dynamic = 'force-dynamic';

export default async function QcPage() {
  const user = getSessionUser();
  if (!canAccessDepartment(user, 'QC')) redirect(roleHome(user));

  const certificates = await getTestCertificates();

  return (
    <main className="container flex flex-col gap-6 py-8">
      <PageHeader title="Test Certificates" description="Entered once, referenced by every part cut from that batch." />
      <TcBank certificates={certificates} />
    </main>
  );
}
