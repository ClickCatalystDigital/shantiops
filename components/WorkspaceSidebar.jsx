'use client';

import { useState } from 'react';
import {
  SidebarProvider, Sidebar, SidebarHeader, SidebarContent, SidebarGroup, SidebarGroupLabel,
  SidebarGroupContent, SidebarMenu, SidebarMenuItem, SidebarMenuButton,
  SidebarMenuSub, SidebarMenuSubItem, SidebarMenuSubButton,
  SidebarTrigger, SidebarInset, SidebarRail,
} from '@/components/ui/sidebar';
import { Separator } from '@/components/ui/separator';
import { LayoutPanelTopIcon, ChevronRightIcon } from 'lucide-react';
import { cn } from '@/lib/utils';

// Shared shell for workspace-level navigation. The content stays owned by each workspace;
// this component only standardizes the sidebar behavior and visual language.
// `groups` (optional): [{ label, items }] — for menus with sections (e.g. Sales/Marketing).
// Falls back to flat `items` when omitted. A flat item can itself be `{ key, label, icon, group:
// true, children: [{key,label,icon}, ...] }` — renders as a parent row that expands into a
// sub-menu (same SidebarMenuSub pattern DepartmentHelpWorkspace.jsx uses for its Notifications
// group), for a workspace tab with two or three closely-related sub-views instead of two flat
// tabs users have to remember are related.
// `header` (optional): custom node rendered in a pinned bar above scrollable children, replacing
// the default mobile-only trigger bar with one that's visible at every breakpoint.
export default function WorkspaceSidebar({ title, icon: TitleIcon = LayoutPanelTopIcon, items, groups, activeKey, onChange, children, nested = false, hideHeader = false, header }) {
  const flatItems = groups ? groups.flatMap(g => g.items) : items.flatMap(item => item.group ? item.children : item);
  const activeItem = flatItems.find(item => item.key === activeKey) || flatItems[0];
  // Accordion, one department open at a time — a `groups` sidebar with many sections (e.g. Reports'
  // 9 departments, 44 items total) used to render every group fully expanded, so "navigate" meant
  // scroll past everything else. Default open = whichever group holds the active item, so switching
  // reports never surprises you by collapsing your own place.
  const defaultOpenGroup = groups?.find(g => g.items.some(i => i.key === activeKey))?.label ?? groups?.[0]?.label;
  const [openGroup, setOpenGroup] = useState(defaultOpenGroup);

  if (nested) {
    return (
      <div className="grid min-w-0 gap-4 md:grid-cols-[13rem_minmax(0,1fr)]">
        <aside className="min-w-0 rounded-xl border bg-sidebar/30 p-2">
          {!hideHeader && (
            <div className="flex items-center gap-2 px-2 py-2 text-sm font-semibold">
              <TitleIcon className="size-4 text-muted-foreground" />
              <span className="truncate">{title}</span>
            </div>
          )}
          <nav className={cn('flex gap-1 overflow-x-auto md:flex-col', !hideHeader && 'mt-1')}>
            {items.map(item => {
              const Icon = item.icon || LayoutPanelTopIcon;
              return (
                <button key={item.key} type="button" onClick={() => onChange(item.key)} className={cn(
                  'flex shrink-0 items-center gap-2 rounded-md px-2.5 py-2 text-left text-sm transition-colors',
                  activeKey === item.key ? 'bg-secondary font-medium text-secondary-foreground' : 'text-muted-foreground hover:bg-muted hover:text-foreground',
                )}>
                  <Icon className="size-4" />
                  <span className="truncate">{item.label}</span>
                </button>
              );
            })}
          </nav>
        </aside>
        <div className="min-w-0">{children}</div>
      </div>
    );
  }

  return (
    <SidebarProvider>
      <Sidebar collapsible="icon">
        <SidebarHeader className="gap-2 px-3 py-3.5 group-data-[collapsible=icon]:px-2">
          <div className="flex items-center gap-2.5 group-data-[collapsible=icon]:hidden">
            <div className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-sidebar-primary text-sidebar-primary-foreground">
              <TitleIcon className="size-4" />
            </div>
            <div className="min-w-0 flex-1 truncate text-sm font-semibold tracking-tight">{title}</div>
            <SidebarTrigger className="ml-auto" />
          </div>
          <div className="hidden justify-center group-data-[collapsible=icon]:flex">
            <SidebarTrigger aria-label={`Expand ${title} sidebar`} />
          </div>
        </SidebarHeader>
        <SidebarContent>
          {groups ? groups.map(group => {
            const isOpen = openGroup === group.label;
            return (
            <SidebarGroup key={group.label}>
              <SidebarGroupLabel asChild>
                <button type="button" className="flex w-full items-center gap-1.5 text-left" onClick={() => setOpenGroup(isOpen ? null : group.label)}>
                  <ChevronRightIcon className={cn('size-3.5 shrink-0 transition-transform', isOpen && 'rotate-90')} />
                  <span className="flex-1 truncate">{group.label}</span>
                  <span className="text-[10px] tabular-nums text-muted-foreground/70">{group.items.length}</span>
                </button>
              </SidebarGroupLabel>
              {isOpen && (
              <SidebarGroupContent>
                <SidebarMenu>
                  {group.items.map(item => {
                    const Icon = item.icon || LayoutPanelTopIcon;
                    return (
                      <SidebarMenuItem key={item.key}>
                        <SidebarMenuButton isActive={activeKey === item.key} tooltip={item.label} onClick={() => onChange(item.key)}>
                          <Icon />
                          <span>{item.label}</span>
                          {item.badge != null && <span className="ml-auto text-xs text-muted-foreground">{item.badge}</span>}
                        </SidebarMenuButton>
                      </SidebarMenuItem>
                    );
                  })}
                </SidebarMenu>
              </SidebarGroupContent>
              )}
            </SidebarGroup>
          );}) : (
            <SidebarGroup>
              <SidebarGroupContent>
                <SidebarMenu>
                  {items.map(item => {
                    const Icon = item.icon || LayoutPanelTopIcon;
                    if (item.group) return (
                      <SidebarMenuItem key={item.key}>
                        <SidebarMenuButton isActive={item.children.some(c => c.key === activeKey)} tooltip={item.label} onClick={() => onChange(item.children[0].key)}>
                          <Icon />
                          <span>{item.label}</span>
                        </SidebarMenuButton>
                        <SidebarMenuSub>
                          {item.children.map(child => (
                            <SidebarMenuSubItem key={child.key}>
                              <SidebarMenuSubButton isActive={activeKey === child.key} onClick={() => onChange(child.key)} className="cursor-pointer">
                                <span>{child.label}</span>
                              </SidebarMenuSubButton>
                            </SidebarMenuSubItem>
                          ))}
                        </SidebarMenuSub>
                      </SidebarMenuItem>
                    );
                    return (
                      <SidebarMenuItem key={item.key}>
                        <SidebarMenuButton isActive={activeKey === item.key} tooltip={item.label} onClick={() => onChange(item.key)}>
                          <Icon />
                          <span>{item.label}</span>
                          {item.badge != null && <span className="ml-auto text-xs text-muted-foreground">{item.badge}</span>}
                        </SidebarMenuButton>
                      </SidebarMenuItem>
                    );
                  })}
                </SidebarMenu>
              </SidebarGroupContent>
            </SidebarGroup>
          )}
        </SidebarContent>
        <SidebarRail />
      </Sidebar>
      <SidebarInset>
        {header ? (
          <div className="sticky top-14 z-30 flex items-center gap-3 border-b bg-background/80 backdrop-blur supports-[backdrop-filter]:bg-background/60 px-4 py-3.5 print:hidden">
            <SidebarTrigger className="md:hidden" />
            <Separator orientation="vertical" className="h-5 md:hidden" />
            {header}
          </div>
        ) : (
          <div className="sticky top-14 z-30 flex items-center gap-3 border-b bg-background/80 backdrop-blur supports-[backdrop-filter]:bg-background/60 px-4 py-3.5 md:hidden">
            <SidebarTrigger />
            <Separator orientation="vertical" className="h-5" />
            <TitleIcon className="size-4 text-muted-foreground" />
            <span className="truncate text-sm font-semibold">{activeItem?.label || title}</span>
          </div>
        )}
        {/* overflow-x-hidden (not the old overflow-auto shorthand) is load-bearing: this is a
            flex-col container, and a wide descendant (a table needing real horizontal scroll,
            e.g. BomTable) can still push this box's own width outward in the cross axis even with
            min-w-0 on every child down the chain. Hidden on x forces this box to never grow past
            its own layout width regardless; the descendant's own overflow-x-auto still handles
            its internal scrolling exactly as before. */}
        <div className="flex min-w-0 flex-1 flex-col gap-4 overflow-y-auto overflow-x-hidden p-4 md:p-6">{children}</div>
      </SidebarInset>
    </SidebarProvider>
  );
}
