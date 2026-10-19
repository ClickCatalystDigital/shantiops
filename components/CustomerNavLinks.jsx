// Left side of the customer headers (portal + Shop): logo, My orders, Shop. No hooks, so it renders
// in both server pages and the client Shop shell.
import Link from 'next/link';

const linkCls = on => `rounded-md px-2.5 py-1.5 text-sm font-medium transition ${on ? 'bg-muted text-foreground' : 'text-muted-foreground hover:bg-muted/60 hover:text-foreground'}`;

export default function CustomerNavLinks({ active }) {
  return (
    <div className="flex min-w-0 items-center gap-1 sm:gap-3">
      <Link href="/portal" className="mr-1 text-base font-bold tracking-tight"><span className="text-muted-foreground">SB</span><span className="text-primary">OPS</span></Link>
      <nav className="flex items-center gap-0.5">
        <Link href="/portal" className={linkCls(active === 'orders')} aria-current={active === 'orders' ? 'page' : undefined}>My orders</Link>
        <Link href="/shop" className={linkCls(active === 'shop')} aria-current={active === 'shop' ? 'page' : undefined}>Shop</Link>
      </nav>
    </div>
  );
}
