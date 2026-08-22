'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname, useSearchParams, useRouter } from 'next/navigation';
import {
  SunIcon, MoonIcon, SettingsIcon, LogOutIcon, LayoutGridIcon, BarChart3Icon,
  LayoutDashboardIcon, FolderKanbanIcon, PackageIcon, ShieldCheckIcon, InfoIcon,
  CalendarDaysIcon, HardHatIcon, ShoppingCartIcon, InboxIcon, FlaskConicalIcon,
  TagIcon, WarehouseIcon, TrendingUpIcon, UsersIcon, CalculatorIcon, MapPinIcon, NetworkIcon,
  LandmarkIcon,
} from 'lucide-react';
import { DEPARTMENTS } from '@/lib/milestones';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem,
  DropdownMenuSeparator, DropdownMenuSub, DropdownMenuSubTrigger, DropdownMenuSubContent,
  DropdownMenuLabel,
} from '@/components/ui/dropdown-menu';
import NotificationBell from './NotificationBell';

export default function Nav({ user, reportDepartments = [] }) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const router = useRouter();
  const [theme, setTheme] = useState('light');
  const [brand, setBrand] = useState({ prefix: 'SB'});

  const isPMUser = user && ['admin', 'manager', 'executive'].includes(user.role);
  // Executive keeps the Executive/Approvals/Operations-filter surface but not the per-department
  // operational workspace tabs (Procurement, Stores, Sales, ...) — those stay admin/manager only.
  // Help (`isPM()`-gated, unchanged) still shows executive every department's guide.
  const isDeptPM = user && ['admin', 'manager'].includes(user.role);
  const departments = user?.departments || [];
  const tabDepartments = isDeptPM ? DEPARTMENTS : departments;
  // Departments the user can browse: PM → all; head → their granted list. Packing lives under Dispatch.
  const accessibleDepts = isPMUser ? DEPARTMENTS : departments;
  const activeDept = searchParams.get('dept');
  // Tasks is a shared department-aware workspace; Home remains the common landing tab. Workers
  // stays Production's own shop-floor surface, enforced by the page via inDepartment().
  // Group 5 Bundle A — the unified PR flow's shared "Requests" surface for Eng/Design/Stores.
  // A PM sees it as part of the all-department oversight tabs; a dual-role head with Procurement
  // access keeps the existing single Procurement workspace experience.
  const canSeeRequests = isDeptPM || (
    !departments.includes('Procurement') && ['Engineering', 'Design', 'Stores'].some(d => departments.includes(d))
  );
  // Workspace tabs are derived from current department grants. Shared Sales/Marketing and
  // Design/Engineering workspaces appear once, so adding access in Settings immediately changes
  // the user's tab set on the next render without hard-coded per-user roles.
  const deptTabs = [];
  const addDeptTab = (depts, href, label, icon) => {
    if (isDeptPM && (href === '/production' || href === '/production/workers')) return;
    if (depts.some(d => tabDepartments.includes(d))) deptTabs.push({ href, label, icon });
  };
  // Tasks (/production) dropped — identical content to Home for a Production head, kept as a
  // compatibility URL only (SYSTEM.md nav history). Workers renamed Job Card, then the top-level
  // tab renamed again to Production (2026-08-19) once Work Orders/BOM/Forecast/Daily Sheet/Workers
  // Roster all lived under it too — Job Card is now just its default sub-tab (WorkersPanel.jsx),
  // same "workspace name ≠ default sub-tab name" pattern every other department tab already uses.
  addDeptTab(['Production'], '/production/workers', 'Production', HardHatIcon);
  addDeptTab(['Procurement'], '/procurement', 'Procurement', ShoppingCartIcon);
  addDeptTab(['Stores'], '/stores', 'Inventory', WarehouseIcon);
  addDeptTab(['Sales', 'Marketing'], '/sales', 'Sales', TagIcon);
  addDeptTab(['Sales', 'Marketing'], '/pipeline', 'Pipeline', TrendingUpIcon);
  addDeptTab(['Sales', 'Marketing'], '/crm-reports', 'Reports', BarChart3Icon);
  addDeptTab(['HR'], '/hr', 'HR', UsersIcon);
  addDeptTab(['Design', 'Engineering'], '/calc', 'Calc Sheets', CalculatorIcon);
  // STERP items 16-19 (§5o) — BOM Structure/Where-Used/Common-Uncommon/ECN. Deliberately gated to
  // the same ['Design','Engineering'] pair as Calc Sheets above (the owner's ask: one shared tab
  // today, split-ready later) rather than 'Engineering' alone — every route/action key underneath
  // it still keys to 'Engineering' specifically, so a future split only touches this one line.
  addDeptTab(['Design', 'Engineering'], '/engineering', 'Engineering', NetworkIcon);
  addDeptTab(['QC'], '/qc', 'QC', FlaskConicalIcon);
  addDeptTab(['Dispatch'], '/ops?dept=Dispatch', 'Dispatch', PackageIcon);
  addDeptTab(['Installation'], '/installation', 'Installation', MapPinIcon);
  addDeptTab(['Accounts'], '/accounts', 'Accounts', LandmarkIcon);
  // Catalog-driven (lib/reports/catalog.js via reportDepartments, computed server-side in
  // app/layout.js — the catalog itself pulls in server-only DB code and can't be imported here): a
  // "Reports" tab only for departments that actually have >=1 report. One call per department so
  // this needs no further Nav edits as the catalog grows.
  // isDeptPM (admin/manager) skips this loop entirely — with every department granted, it would
  // build one identically-labeled "Reports" tab per department (a wall of tabs a user can't tell
  // apart). They get ONE consolidated "/reports" tab instead (below, all departments + Management
  // in one sidebar, app/reports/page.js) — same reasoning as Executive's own gate above.
  // KNOWN, DELIBERATE OVERLAP: Sales/Marketing already has its own "Reports" tab (line above,
  // /crm-reports — a different, pre-existing browser-print mechanism, not this catalog). A
  // single-department head with Sales access sees both, pointing different places, until
  // /crm-reports is folded into this catalog (REPORT-ENGINE-PLAN: deferred cleanup, not done in
  // this pass). Not fixed here — merging them is real scope beyond the frame/catalog/Trial-Balance
  // proof this pass covers.
  if (isDeptPM) {
    deptTabs.push({ href: '/reports', label: 'Reports', icon: BarChart3Icon });
  } else {
    for (const dept of reportDepartments) addDeptTab([dept], `/reports?dept=${dept}`, 'Reports', BarChart3Icon);
  }
  if (canSeeRequests) deptTabs.push({ href: '/pr', label: 'Requests', icon: InboxIcon });

  // Primary tabs (top bar on desktop, bottom bar on mobile). No Packing tab — it's Dispatch-scoped.
  const LINKS = [
    { href: '/', label: 'Home', icon: CalendarDaysIcon },
    { href: '/ops', label: 'Operations', icon: LayoutDashboardIcon },
    { href: '/projects', label: 'Projects', icon: FolderKanbanIcon },
    ...(isPMUser ? [{ href: '/executive', label: 'Executive', icon: BarChart3Icon }] : []),
    // Only the pure 'executive' role (isPMUser but not isDeptPM) — admin/manager get the same 5
    // Management reports folded into their consolidated "/reports" tab instead (below), so this
    // would otherwise be a second, differently-scoped "Reports" tab sitting right next to it.
    // 'executive' has no department access to consolidate, so this stays its only Reports surface.
    ...(isPMUser && !isDeptPM ? [{ href: '/executive/reports', label: 'Reports', icon: LandmarkIcon }] : []),
    ...(isPMUser ? [{ href: '/approvals', label: 'Approvals', icon: ShieldCheckIcon }] : []),
    ...deptTabs,
  ];

  // Query-qualified workspace tabs (currently Dispatch) activate only on their own route/filter.
  const isActive = l => {
    const [base, query] = l.href.split('?');
    const requiredDept = query ? new URLSearchParams(query).get('dept') : null;
    return pathname === base && (requiredDept ? activeDept === requiredDept : !activeDept);
  };

  useEffect(() => {
    const saved = localStorage.getItem('theme') || 'light';
    setTheme(saved);
    document.documentElement.setAttribute('data-theme', saved);
    fetch('/api/config/brand').then(r => r.json()).then(setBrand).catch(() => {});
  }, []);

  function toggleTheme() {
    const next = theme === 'dark' ? 'light' : 'dark';
    setTheme(next);
    document.documentElement.setAttribute('data-theme', next);
    localStorage.setItem('theme', next);
  }

  async function logout() {
    await fetch('/api/logout', { method: 'POST' });
    router.push('/login');
    router.refresh();
  }

  return (
    <>
      {/* Top bar */}
      <header className="sticky top-0 z-40 border-b bg-background/80 backdrop-blur supports-[backdrop-filter]:bg-background/60">
        <div className="container flex h-14 items-center gap-4">
          <Link href="/" className="flex items-center gap-2 text-base font-bold tracking-tight">
            {/* Interim logo from public/logo.svg (static). Will be replaced by an inlined <Logo/>
                component so only the inner ring/center rotates. Hides gracefully until the file exists. */}
            <img
              src="/logo.svg"
              alt=""
              aria-hidden
              className="logo size-7 shrink-0 md:size-8"
              onError={(e) => {
                e.currentTarget.style.display = "none";
              }}
            />
            <h1 className="text-xl font-bold tracking-tight">
              <span className="text-muted-foreground">SB</span><span className="text-primary">OPS</span>
            </h1>
          </Link>

          {/* Desktop tabs */}
          <nav className="ml-2 hidden items-center gap-1 md:flex">
            {LINKS.map(l => (
              <Link key={l.href} href={l.href}
                className={cn('rounded-md px-3 py-1.5 text-sm font-medium transition-colors',
                  isActive(l) ? 'bg-secondary text-secondary-foreground' : 'text-muted-foreground hover:bg-muted hover:text-foreground')}>
                {l.label}
              </Link>
            ))}
          </nav>

          <div className="ml-auto flex items-center gap-1">
            <NotificationBell />
            <Button asChild variant="ghost" size="icon-sm" aria-label="Help">
              <Link href="/help"><InfoIcon /></Link>
            </Button>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon-sm" aria-label="Menu"><SettingsIcon /></Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-52">
                {user?.display_name && (
                  <>
                    <DropdownMenuLabel className="font-normal">
                      <div className="text-sm font-medium">{user.display_name}</div>
                      <div className="text-xs text-muted-foreground">@{user.username}</div>
                    </DropdownMenuLabel>
                    <DropdownMenuSeparator />
                  </>
                )}
                <DropdownMenuItem onClick={toggleTheme}>
                  {theme === 'dark' ? <SunIcon data-icon="inline-start" /> : <MoonIcon data-icon="inline-start" />}
                  {theme === 'dark' ? 'Light mode' : 'Dark mode'}
                </DropdownMenuItem>
                {(isPMUser || accessibleDepts.length > 1) && (
                  <DropdownMenuSub>
                    <DropdownMenuSubTrigger><LayoutGridIcon data-icon="inline-start" />Departments</DropdownMenuSubTrigger>
                    <DropdownMenuSubContent>
                      {accessibleDepts.map(d => (
                        <DropdownMenuItem key={d} onClick={() => router.push(`/ops?dept=${d}`)}>
                          {d === 'Dispatch' && <PackageIcon data-icon="inline-start" />}{d}
                        </DropdownMenuItem>
                      ))}
                    </DropdownMenuSubContent>
                  </DropdownMenuSub>
                )}
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={() => router.push('/settings')}><SettingsIcon data-icon="inline-start" />Settings</DropdownMenuItem>
                <DropdownMenuItem onClick={logout} variant="destructive"><LogOutIcon data-icon="inline-start" />Logout</DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>
      </header>

      {/* Mobile bottom tab bar — app-like */}
      <nav className="fixed inset-x-0 bottom-0 z-40 border-t bg-background/95 backdrop-blur md:hidden">
        <div className="mx-auto flex max-w-md items-stretch justify-around px-1 pb-[env(safe-area-inset-bottom)]">
          {LINKS.map(l => {
            const Icon = l.icon;
            const active = isActive(l);
            return (
              <Link key={l.href} href={l.href}
                className={cn('flex min-w-0 flex-1 flex-col items-center gap-0.5 py-2 text-[10px] font-medium transition-colors',
                  active ? 'text-primary' : 'text-muted-foreground')}>
                <Icon className={cn('size-5', active && 'fill-primary/10')} />
                <span className="truncate">{l.label}</span>
              </Link>
            );
          })}
        </div>
      </nav>
    </>
  );
}
