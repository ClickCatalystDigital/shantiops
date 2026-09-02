import { redirect } from 'next/navigation';

// Packing is now reached via Dispatch's own workspace, not as a standalone tab.
export default function Packing() {
  redirect('/dispatch');
}
