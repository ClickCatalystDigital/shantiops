// lib/qc-entities.js

// The legal entity behind a folder is DERIVED from the maker-number prefix (QC-FOLDER-DESIGN.md §2A),
// never picked by hand: SB- → Shanti Boilers & Pressure Vessels, STF- → Shanti Techno Fab. Supplies
// the covering letter's letterhead, ref prefix, and signature block.
// `contact` feeds the page footer (qc-folder-pdf.js). SB's values are the real ones off the
// letterhead; STF's are reused as a placeholder — ponytail: confirm STF's own phone/email/pin code.
const SB_CONTACT = {
  mobile: '+91 9071118080',
  landline: '+91-40-2717 4042',
  whatsapp: '+1-731-318-5331',
  emails: ['sales@shantiboilers.com', 'info@shantiboilers.com'],
  website: 'www.shantiboilers.com',
};

export const ENTITIES = {
  SB: {
    name: 'Shanti Boilers & Pressure Vessels (P) Ltd',
    address: '# P-10-10, IDA Nacharam, Hyderabad - 500076 Telangana, India.',
    refPrefix: 'SB/QC/OW',
    contact: SB_CONTACT,
  },
  STF: {
    name: 'Shanti Techno Fab Pvt Ltd',
    address: 'Kucharam, Hyderabad',
    refPrefix: 'STF/QC/OW',
    contact: SB_CONTACT, // ponytail: placeholder, same as SB until STF's own details are confirmed
  },
};

// STF- makers → Shanti Techno Fab; everything else (SB-, SB-SIB-, SB-EXP-, …) → Shanti Boilers.
export function entityForMaker(makerNo) {
  return String(makerNo || '').toUpperCase().startsWith('STF') ? ENTITIES.STF : ENTITIES.SB;
}

// Default covering-letter recipient (a folder can override to the customer instead).
export const DIRECTOR_OF_BOILERS = {
  name: 'The Director of Boilers',
  address: 'HNO: 2-2-647/182/A, 3rd Floor, Azam Complex, Shivam Road, Bagh Amberpet, Hyderabad-13, Telangana',
};