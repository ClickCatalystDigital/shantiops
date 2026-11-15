// Old per-project sheet list: the Calc Sheets page now lists every sheet, filtered by project.
import { redirect } from 'next/navigation';

export default async function CalcProjectSheets(props) {
  const { projectId } = await props.params;
  redirect(`/calc?project=${encodeURIComponent(projectId)}`);
}
