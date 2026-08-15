'use client';

import {
  SidebarProvider, Sidebar, SidebarHeader, SidebarContent, SidebarGroup,
  SidebarGroupContent, SidebarMenu, SidebarMenuItem, SidebarMenuButton,
  SidebarTrigger, SidebarInset, SidebarRail,
} from '@/components/ui/sidebar';
import { Separator } from '@/components/ui/separator';
import { LayoutPanelTopIcon } from 'lucide-react';
import { cn } from '@/lib/utils';

// Shared shell for workspace-level navigation. The content stays owned by each workspace;
// this component only standardizes the sidebar behavior and visual language.
export default function WorkspaceSidebar({ title, icon: TitleIcon = LayoutPanelTopIcon, items, activeKey, onChange, children, nested = false, hideHeader = false }) {
  const activeItem = items.find(item => item.key === activeKey) || items[0];

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
          <div className="flex items-center gap-2.5 group-data-[collapsible=icon]:justify-center group-data-[collapsible=icon]:gap-0">
            <div className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-sidebar-primary text-sidebar-primary-foreground">
              <TitleIcon className="size-4" />
            </div>
            <div className="min-w-0 flex-1 truncate text-sm font-semibold tracking-tight group-data-[collapsible=icon]:hidden">{title}</div>
            <SidebarTrigger className="ml-auto group-data-[collapsible=icon]:hidden" />
          </div>
          <div className="hidden justify-center group-data-[collapsible=icon]:flex">
            <SidebarTrigger aria-label={`Expand ${title} sidebar`} />
          </div>
        </SidebarHeader>
        <SidebarContent>
          <SidebarGroup>
            <SidebarGroupContent>
              <SidebarMenu>
                {items.map(item => {
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
          </SidebarGroup>
        </SidebarContent>
        <SidebarRail />
      </Sidebar>
      <SidebarInset>
        <div className="flex items-center gap-3 border-b bg-muted/20 px-4 py-3.5 md:hidden">
          <SidebarTrigger />
          <Separator orientation="vertical" className="h-5" />
          <TitleIcon className="size-4 text-muted-foreground" />
          <span className="truncate text-sm font-semibold">{activeItem?.label || title}</span>
        </div>
        <div className="flex min-w-0 flex-1 flex-col gap-4 p-4 md:p-6">{children}</div>
      </SidebarInset>
    </SidebarProvider>
  );
}
