'use client';

// components/CrmHelpWorkspace.jsx — the CRM section of /help, sidebar: Introduction to Sales |
// Features (one page per element, filtered by which department the viewer holds) | How To. Same
// shadcn Sidebar pattern as SalesWorkspace/CrmReportsWorkspace/CalcWorkspace. Sales/Marketing had
// no /help content at all before this (components/help-content.jsx's HEAD_GUIDES has no Sales or
// Marketing entry) — this fills that gap without touching the existing department-grid page.
import { useState } from 'react';
import {
  SidebarProvider, Sidebar, SidebarHeader, SidebarContent, SidebarGroup, SidebarGroupLabel,
  SidebarGroupContent, SidebarMenu, SidebarMenuItem, SidebarMenuButton,
  SidebarTrigger, SidebarInset, SidebarRail,
} from '@/components/ui/sidebar';
import { Separator } from '@/components/ui/separator';
import { Badge } from '@/components/ui/badge';
import { BookOpenIcon, InfoIcon, ListChecksIcon } from 'lucide-react';
import { CRM_INTRO, CRM_FEATURES, CRM_HOWTO } from '@/components/help-crm-content';

function NumberedSteps({ steps }) {
  return (
    <div className="flex flex-col gap-3">
      {steps.map((s, i) => (
        <div key={s.title} className="flex gap-3">
          <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-accent text-xs font-semibold text-accent-foreground">{i + 1}</span>
          <div>
            <div className="text-sm font-medium">{s.title}</div>
            <p className="text-sm text-muted-foreground">{s.body}</p>
          </div>
        </div>
      ))}
    </div>
  );
}

export default function CrmHelpWorkspace({ departments = ['Sales', 'Marketing'] }) {
  const features = CRM_FEATURES.filter(f => !f.depts || f.depts.some(d => departments.includes(d)));
  const [page, setPage] = useState('intro');
  const activeFeature = features.find(f => f.key === page);

  return (
    <SidebarProvider>
      <Sidebar collapsible="icon">
        <SidebarHeader className="gap-3 px-3 py-3.5">
          <div className="flex items-center gap-2.5">
            <div className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-sidebar-primary text-sidebar-primary-foreground">
              <BookOpenIcon className="size-4" />
            </div>
            <div className="min-w-0 flex-1 truncate text-sm font-semibold tracking-tight group-data-[collapsible=icon]:hidden">CRM Help</div>
            <SidebarTrigger className="ml-auto group-data-[collapsible=icon]:hidden" />
          </div>
        </SidebarHeader>
        <SidebarContent>
          <SidebarGroup>
            <SidebarGroupContent>
              <SidebarMenu>
                <SidebarMenuItem>
                  <SidebarMenuButton isActive={page === 'intro'} tooltip="Introduction to Sales" onClick={() => setPage('intro')}>
                    <InfoIcon /><span>Introduction to Sales</span>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
          <SidebarGroup>
            <SidebarGroupLabel>Features</SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                {features.map(f => (
                  <SidebarMenuItem key={f.key}>
                    <SidebarMenuButton isActive={page === f.key} tooltip={f.label} onClick={() => setPage(f.key)}>
                      <f.icon /><span>{f.label}</span>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                ))}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
          <SidebarGroup>
            <SidebarGroupContent>
              <SidebarMenu>
                <SidebarMenuItem>
                  <SidebarMenuButton isActive={page === 'howto'} tooltip="How To" onClick={() => setPage('howto')}>
                    <ListChecksIcon /><span>How To</span>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        </SidebarContent>
        <SidebarRail />
      </Sidebar>

      <SidebarInset>
        <div className="flex items-center gap-3 border-b bg-muted/20 px-4 py-3.5">
          <SidebarTrigger className="md:hidden" />
          <Separator orientation="vertical" className="h-5 md:hidden" />
          <div className="min-w-0 flex-1">
            <h1 className="text-base font-semibold leading-tight">
              {page === 'intro' ? CRM_INTRO.title : page === 'howto' ? 'How To' : activeFeature?.label}
            </h1>
          </div>
          {activeFeature?.depts && <Badge variant="outline">{activeFeature.depts.join(' / ')} only</Badge>}
        </div>
        <div className="flex-1 overflow-auto p-4">
          <div className="mx-auto flex max-w-2xl flex-col gap-4">
            {page === 'intro' && CRM_INTRO.body.map((p, i) => <p key={i} className="text-sm leading-relaxed text-muted-foreground">{p}</p>)}
            {page === 'howto' && <NumberedSteps steps={CRM_HOWTO} />}
            {activeFeature && activeFeature.body.map((p, i) => <p key={i} className="text-sm leading-relaxed text-muted-foreground">{p}</p>)}
          </div>
        </div>
      </SidebarInset>
    </SidebarProvider>
  );
}
