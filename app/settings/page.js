import { redirect } from 'next/navigation';
import { getFreshSessionUser, isCustomer, isPM, isAdmin, isDesignHead, roleHome } from '@/lib/auth';
import { getFunctionalHeads, getDesignTeamMembers, getAvailableSystemEmployees } from '@/lib/data';
import { queryOne, queryAll } from '@/lib/db';
import { ACTION_CATALOG } from '@/lib/action-permissions';
import { MILESTONE_TEMPLATE } from '@/lib/milestones';
import ChangePasswordForm from '@/components/ChangePasswordForm';
import ProfileForm from '@/components/ProfileForm';
import AccessMatrix from '@/components/AccessMatrix';
import ActionPermissionsPanel from '@/components/ActionPermissionsPanel';
import DependencyChainPanel from '@/components/DependencyChainPanel';
import UserManagement from '@/components/UserManagement';
import TotpSetup from '@/components/TotpSetup';
import DesignAccessPanel from '@/components/DesignAccessPanel';
import PageHeader from '@/components/PageHeader';
import { Separator } from '@/components/ui/separator';

export const dynamic = 'force-dynamic';

export default async function Settings() {
  const user = await getFreshSessionUser();
  if (isCustomer(user)) redirect(roleHome(user));

  const heads = isPM(user) ? await getFunctionalHeads() : null;
  const designTeam = isDesignHead(user) ? await getDesignTeamMembers() : null;
  const availableEmployees = isPM(user) ? await getAvailableSystemEmployees() : [];
  const totpConfigured = isPM(user)
    ? !!(await queryOne('SELECT totp_secret FROM users WHERE id = ?', [user.id]))?.totp_secret
    : false;
  const actionPermissions = isPM(user) ? await queryAll('SELECT department, action_key, requires_head FROM action_permissions') : [];
  // Dependency chain (SYSTEM.md §5j) — current effective depends_on_key per milestone_key, plus
  // whether every project actually agrees (they should, nothing per-project has diverged this
  // yet, but the chain is per-row so it's not guaranteed — flag it rather than silently picking).
  let dependencyCurrent = {};
  if (isPM(user)) {
    const rows = await queryAll(
      `SELECT milestone_key, depends_on_key, COUNT(*) AS ct FROM milestones
        GROUP BY milestone_key, depends_on_key ORDER BY milestone_key, ct DESC`
    );
    for (const r of rows) {
      if (!dependencyCurrent[r.milestone_key]) {
        dependencyCurrent[r.milestone_key] = { depends_on_key: r.depends_on_key, mixed: false };
      } else {
        dependencyCurrent[r.milestone_key].mixed = true;
      }
    }
  }

  return (
    <main className="container flex flex-col gap-6 py-8">
      <PageHeader title="Settings" description={`Account settings${isPM(user) ? ' and access management' : ''}`} />

      <div className="grid items-start gap-6 lg:grid-cols-2">
        <ProfileForm user={user} />
        <ChangePasswordForm />
      </div>

      {isPM(user) && (
        <>
          <Separator />
          <h2 className="text-lg font-semibold">Access Management</h2>
          <AccessMatrix heads={heads} canAssignHead={isAdmin(user) || ['manager', 'executive'].includes(user.role)} />
          <ActionPermissionsPanel catalog={ACTION_CATALOG} permissions={actionPermissions} />
          <DependencyChainPanel template={MILESTONE_TEMPLATE} current={dependencyCurrent} />
          <UserManagement heads={heads} availableEmployees={availableEmployees} isAdmin={isAdmin(user)} />

          <Separator />
          <h2 className="text-lg font-semibold">USB Device Approval</h2>
          <TotpSetup configured={totpConfigured} />
        </>
      )}
      {isDesignHead(user) && !isPM(user) && <DesignAccessPanel members={designTeam} />}
    </main>
  );
}
