'use client';

// components/executive/charts.jsx — Recharts visuals for the Management reports, built on the
// shadcn chart wrapper (components/ui/chart.jsx, `npx shadcn add chart`) — the first real charting
// dependency in this app, added deliberately for this report set (previous hand-rolled-SVG-only
// precedent, e.g. CalcWorkspace's donut/gauge, predates this decision).
import {
  Bar, BarChart, CartesianGrid, XAxis, YAxis, Cell, LabelList,
  Pie, PieChart, Legend,
} from 'recharts';
import { ChartContainer, ChartTooltip, ChartTooltipContent } from '@/components/ui/chart';

const SUCCESS = 'var(--color-success)';
const DANGER = 'var(--color-danger)';
const WARNING = 'var(--color-warning)';
const CHART1 = 'var(--color-chart-1)';

// Recharts v3's category YAxis wraps tick text into multiple tspans when it doesn't fit the
// allocated `width`, rather than clipping — a full customer/supplier name (vs. a short project
// code like "SB-1025") wrapped across 3 lines and crushed the plot area down to nothing. Truncate
// well inside the column width (not just under it — v3 wraps before it visually overflows) so a
// truncated label always renders on one line; the row list below every chart already has the
// untruncated name.
function truncateLabel(s, max = 13) {
  return s && s.length > max ? `${s.slice(0, max - 1)}…` : s;
}

// Horizontal ranked bar chart — margin by project/customer, colored by sign. Top N only (a full
// project list can run long; the chart is a glance, the row list beneath it still has everything).
export function RankedMarginChart({ items, valueKey = 'value', labelKey = 'label', limit = 8 }) {
  const data = [...items].sort((a, b) => Math.abs(b[valueKey]) - Math.abs(a[valueKey])).slice(0, limit);
  const height = Math.max(120, data.length * 32);
  return (
    <ChartContainer config={{ [valueKey]: { label: 'Margin' } }} className="aspect-auto w-full" style={{ height }}>
      <BarChart data={data} layout="vertical" margin={{ left: 4, right: 24, top: 4, bottom: 4 }}>
        <CartesianGrid horizontal={false} strokeDasharray="3 3" />
        <XAxis type="number" hide />
        <YAxis type="category" dataKey={labelKey} width={170} tickLine={false} axisLine={false}
          tick={{ fontSize: 11 }} tickFormatter={truncateLabel} interval={0} />
        <ChartTooltip content={<ChartTooltipContent formatter={(v) => Number(v).toLocaleString('en-IN')} />} />
        <Bar dataKey={valueKey} radius={4}>
          {data.map((d) => (
            <Cell key={d[labelKey]} fill={d[valueKey] < 0 ? DANGER : SUCCESS} />
          ))}
          <LabelList dataKey={valueKey} position="right" formatter={(v) => Number(v).toLocaleString('en-IN')} className="fill-foreground text-[10px]" />
        </Bar>
      </BarChart>
    </ChartContainer>
  );
}

// Same shape, single color — spend has no sign to encode.
export function RankedSpendChart({ items, valueKey = 'value', labelKey = 'label', limit = 8 }) {
  const data = [...items].sort((a, b) => b[valueKey] - a[valueKey]).slice(0, limit);
  const height = Math.max(120, data.length * 32);
  return (
    <ChartContainer config={{ [valueKey]: { label: 'Spend', color: CHART1 } }} className="aspect-auto w-full" style={{ height }}>
      <BarChart data={data} layout="vertical" margin={{ left: 4, right: 24, top: 4, bottom: 4 }}>
        <CartesianGrid horizontal={false} strokeDasharray="3 3" />
        <XAxis type="number" hide />
        <YAxis type="category" dataKey={labelKey} width={170} tickLine={false} axisLine={false}
          tick={{ fontSize: 11 }} tickFormatter={truncateLabel} interval={0} />
        <ChartTooltip content={<ChartTooltipContent formatter={(v) => Number(v).toLocaleString('en-IN')} />} />
        <Bar dataKey={valueKey} fill={CHART1} radius={4}>
          <LabelList dataKey={valueKey} position="right" formatter={(v) => Number(v).toLocaleString('en-IN')} className="fill-foreground text-[10px]" />
        </Bar>
      </BarChart>
    </ChartContainer>
  );
}

// Grouped comparison — Revenue/Expense/Net Profit, MTD vs FY-to-date.
export function PnlComparisonChart({ mtd, fytd }) {
  const data = [
    { metric: 'Revenue', MTD: mtd.totalIncome, 'FY to date': fytd.totalIncome },
    { metric: 'Expense', MTD: mtd.totalExpense, 'FY to date': fytd.totalExpense },
    { metric: 'Net Profit', MTD: mtd.netProfit, 'FY to date': fytd.netProfit },
  ];
  return (
    <ChartContainer
      config={{ MTD: { label: 'MTD', color: CHART1 }, 'FY to date': { label: 'FY to date', color: SUCCESS } }}
      className="aspect-auto h-56 w-full"
    >
      <BarChart data={data} margin={{ top: 8, right: 8, left: 8, bottom: 8 }}>
        <CartesianGrid vertical={false} strokeDasharray="3 3" />
        <XAxis dataKey="metric" tickLine={false} axisLine={false} tick={{ fontSize: 11 }} />
        <YAxis hide />
        <ChartTooltip content={<ChartTooltipContent formatter={(v) => Number(v).toLocaleString('en-IN')} />} />
        <Legend wrapperStyle={{ fontSize: 11 }} />
        <Bar dataKey="MTD" fill={CHART1} radius={4} />
        <Bar dataKey="FY to date" fill={SUCCESS} radius={4} />
      </BarChart>
    </ChartContainer>
  );
}

// Work Order status mix — donut. Mutually exclusive by `status` (unlike `delayed`, a cross-cutting
// flag an in_progress WO can also carry — shown separately, never as its own slice here, or the
// slices would sum past the total).
export function WorkOrderStatusPie({ inProgress, completed, notStarted, cancelled }) {
  const data = [
    { name: 'Not Started', value: notStarted, color: WARNING },
    { name: 'In Progress', value: inProgress, color: CHART1 },
    { name: 'Completed', value: completed, color: SUCCESS },
    { name: 'Cancelled', value: cancelled, color: 'var(--muted-foreground)' },
  ].filter((d) => d.value > 0);
  if (!data.length) return <p className="py-6 text-center text-xs text-muted-foreground">No Work Orders in range.</p>;
  return (
    <ChartContainer config={{}} className="aspect-auto h-40 w-full">
      <PieChart>
        <ChartTooltip content={<ChartTooltipContent hideLabel />} />
        <Pie data={data} dataKey="value" nameKey="name" innerRadius={36} outerRadius={56} paddingAngle={2}>
          {data.map((d) => <Cell key={d.name} fill={d.color} />)}
        </Pie>
        <Legend wrapperStyle={{ fontSize: 11 }} />
      </PieChart>
    </ChartContainer>
  );
}

// Planned vs Actual cost — simple 2-bar comparison, colored by whether actual overran planned.
export function CostVarianceChart({ planned, actual }) {
  const data = [{ metric: 'Cost', Planned: planned, Actual: actual }];
  const overran = actual > planned;
  return (
    <ChartContainer
      config={{ Planned: { label: 'Planned', color: CHART1 }, Actual: { label: 'Actual', color: overran ? DANGER : SUCCESS } }}
      className="aspect-auto h-32 w-full"
    >
      <BarChart data={data} layout="vertical" margin={{ top: 4, right: 24, left: 4, bottom: 4 }}>
        <CartesianGrid horizontal={false} strokeDasharray="3 3" />
        <XAxis type="number" hide />
        <YAxis type="category" dataKey="metric" hide />
        <ChartTooltip content={<ChartTooltipContent formatter={(v) => Number(v).toLocaleString('en-IN')} />} />
        <Legend wrapperStyle={{ fontSize: 11 }} />
        <Bar dataKey="Planned" fill={CHART1} radius={4} barSize={20}>
          <LabelList dataKey="Planned" position="right" formatter={(v) => Number(v).toLocaleString('en-IN')} className="fill-foreground text-[10px]" />
        </Bar>
        <Bar dataKey="Actual" fill={overran ? DANGER : SUCCESS} radius={4} barSize={20}>
          <LabelList dataKey="Actual" position="right" formatter={(v) => Number(v).toLocaleString('en-IN')} className="fill-foreground text-[10px]" />
        </Bar>
      </BarChart>
    </ChartContainer>
  );
}
