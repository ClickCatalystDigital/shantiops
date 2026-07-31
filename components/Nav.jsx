'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname, useSearchParams, useRouter } from 'next/navigation';
import {
  SunIcon, MoonIcon, SettingsIcon, LogOutIcon, LayoutGridIcon, BarChart3Icon,
  LayoutDashboardIcon, FolderKanbanIcon, PackageIcon, ShieldCheckIcon, InfoIcon,
  CalendarDaysIcon, HardHatIcon,
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

export default function Nav({ user }) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const router = useRouter();
  const [theme, setTheme] = useState('light');
  const [brand, setBrand] = useState({ prefix: 'SB'});

  const isPMUser = user && ['admin', 'manager', 'executive'].includes(user.role);
  const departments = user?.departments || [];
  // Departments the user can browse: PM → all; head → their granted list. Packing lives under Dispatch.
  const accessibleDepts = isPMUser ? DEPARTMENTS : departments;
  const activeDept = searchParams.get('dept');
  // Tasks is now every head department's calendar, not just Production's — any granted
  // department gets the tab. Workers stays Production's own shop-floor surface, so it keeps the
  // stricter single-department check the pages themselves still enforce via inDepartment().
  const hasTasks = departments.length > 0;
  const inProduction = departments.includes('Production');
  // A multi-department head narrows whichever section they're currently in — Tasks or
  // Operations — by department, one shared row of chips rather than a duplicate row per
  // section (that read as unlabeled twins of each other when both existed at once).
  const onTasks = pathname === '/production';
  const deptTabs = departments.length > 1
    ? departments.map(d => ({ href: `${onTasks ? '/production' : '/'}?dept=${d}`, label: d, dept: d, icon: LayoutGridIcon }))
    : [];

  // Primary tabs (top bar on desktop, bottom bar on mobile). No Packing tab — it's Dispatch-scoped.
  const LINKS = isPMUser
    ? [
        { href: '/executive', label: 'Executive', icon: BarChart3Icon },
        { href: '/', label: 'Operations', icon: LayoutDashboardIcon },
        { href: '/projects', label: 'Projects', icon: FolderKanbanIcon },
        { href: '/approvals', label: 'Approvals', icon: ShieldCheckIcon },
      ]
    : [
        ...(hasTasks ? [{ href: '/production', label: 'Tasks', icon: CalendarDaysIcon }] : []),
        ...deptTabs,
        { href: '/', label: 'Operations', icon: LayoutDashboardIcon },
        { href: '/projects', label: 'Projects', icon: FolderKanbanIcon },
        ...(inProduction ? [{ href: '/production/workers', label: 'Workers', icon: HardHatIcon }] : []),
      ];

  // l.dept links narrow whichever base route they point at (Tasks vs Operations both use it) —
  // compare against that link's own pathname, not a hardcoded '/', so the two don't cross-activate.
  const isActive = l => (l.dept
    ? pathname === l.href.split('?')[0] && activeDept === l.dept
    : pathname === l.href && !activeDept);

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
                {accessibleDepts.length > 0 && (
                  <DropdownMenuSub>
                    <DropdownMenuSubTrigger><LayoutGridIcon data-icon="inline-start" />Departments</DropdownMenuSubTrigger>
                    <DropdownMenuSubContent>
                      {accessibleDepts.map(d => (
                        <DropdownMenuItem key={d} onClick={() => router.push(`/?dept=${d}`)}>
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
