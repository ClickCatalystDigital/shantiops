import { redirect } from 'next/navigation';

// Packing is now reached within the Dispatch department, not as a standalone tab.
export default function Packing() {
  redirect('/ops?dept=Dispatch');
}
