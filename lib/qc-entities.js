// The legal entity behind a folder is DERIVED from the maker-number prefix (QC-FOLDER-DESIGN.md §2A),
// never picked by hand: SB- → Shanti Boilers & Pressure Vessels, STF- → Shanti Techno Fab. Supplies
// the covering letter's letterhead, ref prefix, and signature block.
export const ENTITIES = {
  SB: {
    name: 'Shanti Boilers & Pressure Vessels (P) Ltd',
    address: 'P-10-10, Road No.5, IDA Nacharam, Hyderabad',
    refPrefix: 'SB/QC/OW',
  },
  STF: {
    name: 'Shanti Techno Fab Pvt Ltd',
    address: 'Kucharam, Hyderabad',
    refPrefix: 'STF/QC/OW',
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
