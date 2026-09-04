'use client';

// components/DrawingsProjectView.jsx — thin client boundary for app/calc-drawings/[projectId]/page.js.
// DrawingsPanel (exported from CalcWorkspace.jsx) needs a router for its mutation handlers'
// router.refresh() calls — that's the one thing a server component can't supply directly.
import { useRouter } from 'next/navigation';
import { DrawingsPanel } from '@/components/CalcWorkspace';

export default function DrawingsProjectView({ drawings, projectId, user, designTeam }) {
  const router = useRouter();
  return <DrawingsPanel drawings={drawings} projectId={projectId} router={router} user={user} designTeam={designTeam} />;
}
