'use client';

import { useState } from 'react';
import {
  SidebarProvider, Sidebar, SidebarHeader, SidebarContent, SidebarGroup, SidebarGroupLabel,
  SidebarGroupContent, SidebarMenu, SidebarMenuItem, SidebarMenuButton,
  SidebarTrigger, SidebarInset, SidebarRail,
} from '@/components/ui/sidebar';
import { Separator } from '@/components/ui/separator';
import { Badge } from '@/components/ui/badge';
import { BookOpenIcon, InfoIcon, ListChecksIcon } from 'lucide-react';
import { DEPARTMENT_HELP } from '@/components/department-help-content';

function GuideBody({ item }) {
  return (
    <div className="flex flex-col gap-5">
      {item.value && (
        <section>
          <h2 className="text-base font-semibold">Why this matters</h2>
          <p className="mt-2 text-sm leading-7 text-muted-foreground">{item.value}</p>
        </section>
      )}
      {item.body && (
        <section>
          <h2 className="text-base font-semibold">{item.bodyHeading || 'How it works in Shanti Ops'}</h2>
          <div className="mt-2 flex flex-col gap-3">
            {item.body.map((paragraph, i) => (
              <p key={`p-${i}`} className="text-sm leading-7 text-muted-foreground">{paragraph}</p>
            ))}
          </div>
        </section>
      )}
      {item.bullets && (
        <ul className="list-disc space-y-2 pl-5 text-sm leading-6 text-muted-foreground">
          {item.bullets.map(bullet => <li key={bullet}>{bullet}</li>)}
        </ul>
      )}
      {item.checklist && (
        <section className="rounded-xl border bg-muted/20 p-4">
          <h2 className="text-sm font-semibold">Work through it</h2>
          <ul className="mt-3 list-disc space-y-2 pl-5 text-sm leading-6 text-muted-foreground">
            {item.checklist.map(point => <li key={point}>{point}</li>)}
          </ul>
        </section>
      )}
      {item.watchOut && (
        <section className="rounded-xl border border-amber-200/70 bg-amber-50/50 p-4 dark:border-amber-900/60 dark:bg-amber-950/20">
          <h2 className="text-sm font-semibold">Avoid this</h2>
          <p className="mt-2 text-sm leading-6 text-muted-foreground">{item.watchOut}</p>
        </section>
      )}
      {item.outcome && (
        <section className="rounded-xl border border-emerald-200/70 bg-emerald-50/50 p-4 dark:border-emerald-900/60 dark:bg-emerald-950/20">
          <h2 className="text-sm font-semibold">Done when</h2>
          <p className="mt-2 text-sm leading-6 text-muted-foreground">{item.outcome}</p>
        </section>
      )}
      {item.table && (
        <div className="overflow-x-auto rounded-lg border">
          <table className="w-full min-w-[520px] text-left text-sm">
            <thead className="bg-muted/50">
              <tr>{item.table.columns.map(column => <th key={column} className="px-3 py-2 font-medium">{column}</th>)}</tr>
            </thead>
            <tbody className="divide-y">
              {item.table.rows.map((row, i) => (
                <tr key={i}>
                  {row.map((cell, j) => <td key={j} className="px-3 py-2 align-top text-muted-foreground">{cell}</td>)}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function NumberedSteps({ steps, department }) {
  return (
    <div className="flex flex-col gap-5">
      <section className="rounded-xl border bg-primary/[0.04] p-4 sm:p-5">
        <div className="flex items-start gap-3">
          <span className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-primary text-lg font-bold text-primary-foreground">✓</span>
          <div>
            <h2 className="text-base font-semibold sm:text-lg">Work through {department} step by step</h2>
            <p className="mt-1 text-sm leading-6 text-muted-foreground">Follow the steps in order when you are doing this work for the first time. Each step explains what to do and what to check before handing work forward.</p>
          </div>
        </div>
        <div className="mt-4 grid gap-2 sm:grid-cols-5">
          {steps.map((step, i) => (
            <div key={step.title} className="rounded-lg border bg-background/70 px-3 py-2">
              <div className="text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">Step {String(i + 1).padStart(2, '0')}</div>
              <div className="mt-1 text-xs font-medium leading-5">{step.title}</div>
            </div>
          ))}
        </div>
      </section>
      <div className="flex flex-col gap-4">
        {steps.map((step, i) => (
          <article key={step.title} className="rounded-xl border p-4 sm:p-5">
            <div className="flex items-start gap-4">
              <span className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-accent text-lg font-bold text-accent-foreground sm:size-12 sm:text-xl">{String(i + 1).padStart(2, '0')}</span>
              <div className="min-w-0 flex-1">
                <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">Step {String(i + 1).padStart(2, '0')}</div>
                <h3 className="mt-1 text-base font-semibold leading-6 sm:text-lg">{step.title}</h3>
                <p className="mt-2 text-sm leading-7 text-muted-foreground">{step.body}</p>
              </div>
            </div>
            {(step.why || step.verify) && (
              <div className="mt-4 grid gap-3 border-t pt-4 sm:grid-cols-2 sm:pl-16">
                {step.why && <div className="rounded-lg bg-muted/40 p-3"><h4 className="text-xs font-semibold uppercase tracking-wide">Why this step matters</h4><p className="mt-1 text-sm leading-6 text-muted-foreground">{step.why}</p></div>}
                {step.verify && <div className="rounded-lg bg-muted/40 p-3"><h4 className="text-xs font-semibold uppercase tracking-wide">Before you continue</h4><p className="mt-1 text-sm leading-6 text-muted-foreground">{step.verify}</p></div>}
              </div>
            )}
          </article>
        ))}
      </div>
    </div>
  );
}

export default function DepartmentHelpWorkspace({ departments = [] }) {
  const available = departments.filter(d => DEPARTMENT_HELP[d]);
  const [department, setDepartment] = useState(available[0]);
  const [page, setPage] = useState('intro');
  const guide = DEPARTMENT_HELP[department] || DEPARTMENT_HELP[available[0]];
  const feature = guide?.features.find(f => f.key === page);
  const GuideIcon = guide?.icon || BookOpenIcon;

  function chooseDepartment(next) {
    setDepartment(next);
    setPage('intro');
  }

  if (!guide) return null;

  const title = page === 'intro' ? `Introduction to ${guide.title}` : page === 'howto' ? 'How To' : feature?.label;
  const activeIcon = page === 'intro' ? InfoIcon : page === 'howto' ? ListChecksIcon : feature?.icon;
  const ActiveIcon = activeIcon || GuideIcon;

  const framework = [
    { title: 'Home', body: 'Start here for your daily calendar, assigned work, and the next actions that belong to your granted departments.' },
    { title: 'Operations', body: 'Use the cross-project view to see department signals, open actions, milestones, blockers, and handoffs in one place.' },
    { title: 'Projects', body: 'Use the project record for the full order history: scope, milestones, calculations, BOM, documents, QC, and dispatch context.' },
    { title: `${guide.title} workspace`, body: 'Use the department tab for detailed records and controls. Keep updates in the correct record so the next department can trust the handoff.' },
  ];

  return (
    <SidebarProvider>
      <Sidebar collapsible="icon">
        <SidebarHeader className="gap-2 px-3 py-3.5 group-data-[collapsible=icon]:px-2">
          <div className="flex items-center gap-2.5 group-data-[collapsible=icon]:justify-center group-data-[collapsible=icon]:gap-0">
            <div className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-sidebar-primary text-sidebar-primary-foreground">
              <GuideIcon className="size-4" />
            </div>
            <div className="min-w-0 flex-1 truncate text-sm font-semibold tracking-tight group-data-[collapsible=icon]:hidden">{guide.title} Help</div>
            <SidebarTrigger className="ml-auto group-data-[collapsible=icon]:hidden" />
          </div>
          <div className="hidden justify-center group-data-[collapsible=icon]:flex">
            <SidebarTrigger aria-label="Expand Help sidebar" />
          </div>
        </SidebarHeader>
        <SidebarContent>
          {available.length > 1 && (
            <SidebarGroup>
              <SidebarGroupLabel>Departments</SidebarGroupLabel>
              <SidebarGroupContent>
                <SidebarMenu>
                  {available.map(d => {
                    const Icon = DEPARTMENT_HELP[d].icon;
                    return (
                      <SidebarMenuItem key={d}>
                        <SidebarMenuButton isActive={department === d} tooltip={d} onClick={() => chooseDepartment(d)}>
                          <Icon /><span>{d}</span>
                        </SidebarMenuButton>
                      </SidebarMenuItem>
                    );
                  })}
                </SidebarMenu>
              </SidebarGroupContent>
            </SidebarGroup>
          )}
          <SidebarGroup>
            <SidebarGroupContent>
              <SidebarMenu>
                <SidebarMenuItem>
                  <SidebarMenuButton isActive={page === 'intro'} tooltip={`Introduction to ${guide.title}`} onClick={() => setPage('intro')}>
                    <InfoIcon /><span>Introduction</span>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
          <SidebarGroup>
            <SidebarGroupLabel>Features</SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                {guide.features.map(item => (
                  <SidebarMenuItem key={item.key}>
                    <SidebarMenuButton isActive={page === item.key} tooltip={item.label} onClick={() => setPage(item.key)}>
                      <item.icon /><span>{item.label}</span>
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
          <ActiveIcon className="size-4 text-muted-foreground" />
          <div className="min-w-0 flex-1">
            <h1 className="text-base font-semibold leading-tight">{title}</h1>
            <p className="text-xs text-muted-foreground">{guide.title} · practical guide</p>
          </div>
          {page !== 'intro' && page !== 'howto' && <Badge variant="outline">Feature guide</Badge>}
        </div>
        <div className="flex-1 overflow-auto p-4 md:p-6">
          <div className="mx-auto flex max-w-3xl flex-col gap-6">
            {page === 'intro' && (
              <>
                <section className="rounded-xl border bg-primary/[0.04] p-5">
                  <h2 className="text-lg font-semibold">Welcome to {guide.title}</h2>
                  <p className="mt-2 text-sm leading-7 text-muted-foreground">
                    This guide explains how your department fits into Shanti Ops, what each workspace is for,
                    and how to leave work ready for the next person.
                  </p>
                </section>
                <GuideBody item={{ body: guide.intro }} />
                <section>
                  <h2 className="text-base font-semibold">How Shanti Ops is organised</h2>
                  <p className="mt-2 text-sm leading-7 text-muted-foreground">
                    Shanti Ops connects one order across departments. Home helps you start the day, Operations
                    shows cross-project work, Projects holds the complete order record, and your department
                    workspace contains the detailed controls for {guide.title}.
                  </p>
                  <div className="mt-4 grid gap-3 sm:grid-cols-2">
                    {framework.map(item => (
                      <div key={item.title} className="rounded-xl border p-4">
                        <h3 className="text-sm font-semibold">{item.title}</h3>
                        <p className="mt-1 text-sm leading-6 text-muted-foreground">{item.body}</p>
                      </div>
                    ))}
                  </div>
                </section>
                <section>
                  <h2 className="text-base font-semibold">Your feature map</h2>
                  <p className="mt-2 text-sm leading-6 text-muted-foreground">Select a feature below for its purpose, practical checklist, and common warning.</p>
                  <div className="mt-4 grid gap-3 sm:grid-cols-2">
                    {guide.features.map(item => {
                      const Icon = item.icon;
                      return (
                        <button key={item.key} type="button" onClick={() => setPage(item.key)} className="group rounded-xl border p-4 text-left transition-colors hover:border-primary/60 hover:bg-muted/30">
                          <div className="flex items-start gap-3">
                            <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-accent text-accent-foreground"><Icon className="size-4" /></span>
                            <span className="min-w-0">
                              <span className="block text-sm font-semibold group-hover:text-primary">{item.label}</span>
                              <span className="mt-1 block text-sm leading-6 text-muted-foreground">{item.body[0]}</span>
                            </span>
                          </div>
                        </button>
                      );
                    })}
                  </div>
                </section>
              </>
            )}
            {page === 'howto' && <NumberedSteps steps={guide.howTo} department={guide.title} />}
            {feature && <GuideBody item={feature} />}
          </div>
        </div>
      </SidebarInset>
    </SidebarProvider>
  );
}
