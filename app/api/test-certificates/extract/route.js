import { NextResponse } from 'next/server';
import { getSessionUser, requireDepartment } from '@/lib/auth';
import { extractFields } from '@/lib/extract';

// V2-CHANGES.md Group 1 — stateless AI populate-from-PDF, called right after a certificate PDF is
// picked in CertForm's overlay, before the row exists. AI only fills fields; the human still
// reviews/edits everything in the form and clicks the existing Add/Save button — this route never
// writes to the DB. Best-effort: if OPENROUTER_API_KEY isn't set yet (R2/AI infra still being
// provisioned), the caller catches the error and just leaves the form for manual entry.
const PROMPT = `You are reading a steel Material Test Certificate (MTC) / Mill Test Certificate PDF.
Extract exactly these fields as a flat JSON object (use null for anything not present — do not guess):
{
  "certificate_no": string,   // the certificate/report number
  "cast_no": string,          // cast/heat number
  "plate_no": string|null,    // plate number, if this cert covers a specific plate
  "material_spec": string,    // material/grade specification, e.g. "SA 516 Gr.70"
  "steel_maker": string,      // the steel mill/maker name
  "size_t": string|null,      // thickness in mm, numeric text only
  "size_w": string|null,      // width in mm, numeric text only
  "size_l": string|null,      // length in mm, numeric text only
  "chem_c": string|null,      // carbon %, of the cast
  "chem_mn": string|null,     // manganese %
  "chem_p": string|null,      // phosphorus %
  "chem_s": string|null,      // sulphur %
  "chem_si": string|null,     // silicon %
  "ys": string|null,          // yield strength, MPa, of this plate
  "uts": string|null,         // ultimate tensile strength, MPa
  "elongation": string|null,  // elongation %
  "bend_test": "OK"|"NOT OK"|null
}
Return ONLY the JSON object, no prose, no markdown fences.`;

export async function POST(req) {
  const user = getSessionUser();
  const denied = requireDepartment(user, 'QC');
  if (denied) return denied;

  const form = await req.formData();
  const file = form.get('file');
  if (!file || typeof file.arrayBuffer !== 'function') {
    return NextResponse.json({ error: 'No PDF provided' }, { status: 400 });
  }
  const buffer = Buffer.from(await file.arrayBuffer());

  try {
    const fields = await extractFields(buffer, PROMPT);
    return NextResponse.json({ fields });
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: 502 });
  }
}
