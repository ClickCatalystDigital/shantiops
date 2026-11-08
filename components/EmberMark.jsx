import { cn } from '@/lib/utils';

// Ember AI's mark: a flame over a grate line, its core breathing, now and then a spark off the tip.
// Same paths as ahromlabs.com/ai-assistant (ahrom-labs AssistantMark.tsx); animated by .ai-ember in globals.css.
export function EmberMark({ className }) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden fill="currentColor" fillOpacity=".13" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"
      className={cn('ai-ember inline-block shrink-0 overflow-visible', className)}>
      <path className="flame" d="M12 3c.7 2.8 3.4 4.9 4.5 7.9.6 1.7.6 3.5-.1 5A4.9 4.9 0 0 1 12 19.4a4.9 4.9 0 0 1-4.5-3.3c-.8-2.3 0-4.6 1.5-6.3.2 1.4.9 2.5 1.9 3C10.5 10 10.9 6.3 12 3z" />
      <path className="core" d="M12 12.6c1 1.1 1.9 2.2 1.9 3.4a1.9 1.9 0 0 1-3.8 0c0-1.2.9-2.3 1.9-3.4z" fillOpacity=".75" />
      <path d="M7.5 21.2h9" fill="none" />
      <circle className="spark" cx="15.6" cy="7.2" r=".7" fillOpacity=".9" stroke="none" />
    </svg>
  );
}
