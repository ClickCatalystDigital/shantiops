'use client';
// The list under a typeahead field (search results, @mentions, pickers). Placed by Radix against the
// screen, so a card or table that clips its contents (overflow-hidden) no longer cuts it off; it
// flips above the field when there is no room below and never runs off-screen. Deliberately not
// portalled: inside a dialog it stays in the dialog's DOM, so the dialog's scroll lock and outside
// click handling treat it as part of the dialog. Mount it only while open (`{open && <FloatingList…>}`);
// `anchorRef` is the field it hangs from. Escape / a click elsewhere call `onClose`.
import { Popover as P } from 'radix-ui';
import { cn } from '@/lib/utils';

export default function FloatingList({ anchorRef, onClose, matchWidth = true, className, children }) {
  return (
    <P.Root open onOpenChange={o => { if (!o) onClose?.(); }}>
      <P.Anchor virtualRef={anchorRef} />
      <P.Content
        align="start" sideOffset={4} collisionPadding={8}
        onOpenAutoFocus={e => e.preventDefault()} onCloseAutoFocus={e => e.preventDefault()}
        // A click on the field itself is not "outside": typing there keeps the list open.
        onInteractOutside={e => { if (anchorRef.current?.contains(e.target)) e.preventDefault(); }}
        style={matchWidth ? { width: 'var(--radix-popover-trigger-width)' } : undefined}
        className={cn('z-50 max-h-[min(16rem,var(--radix-popover-content-available-height))] overflow-y-auto rounded-md border bg-popover text-popover-foreground shadow-md', className)}>
        {children}
      </P.Content>
    </P.Root>
  );
}
