'use client';

// Small shadcn Tabs strip used inside Stores screens that used to stack two or three tables on top of
// each other (Inward, Allocator, Macro Allocator). The parent renders the active panel itself from
// `value`; only the strip lives here so every Stores screen looks and behaves the same.
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';

export default function StoresSubTabs({ value, onChange, tabs }) {
  return (
    <Tabs value={value} onValueChange={onChange}>
      <TabsList className="h-9 self-start">
        {tabs.map(t => (
          <TabsTrigger key={t.value} value={t.value} className="px-3.5">
            {t.label}
            {t.count > 0 && (
              <span className="ml-1.5 rounded-full bg-primary/10 px-1.5 text-[10px] font-semibold tabular-nums text-primary">{t.count}</span>
            )}
          </TabsTrigger>
        ))}
      </TabsList>
    </Tabs>
  );
}
