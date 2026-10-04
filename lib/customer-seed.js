// lib/customer-seed.js — the ONLY place this deployment's customer is written into code. migrate()
// reads it to seed an empty database (companies, their document details, email templates, the QC
// authority address, the PO counter start). After that the database is the source of truth: Accounts
// edits companies in Accounts → Company Entities and nothing reads this file again.
// A new customer deployment sets the CUSTOMER_SEED env var (JSON, same shape as DEFAULT) instead of
// editing this file; unset = the values below.
import { DEFAULT_TEMPLATES } from './customer-seed-templates.mjs';

const CONTACT = {
  contact_mobile: '+91 9071118080',
  contact_landline: '+91-40-2717 4042',
  contact_whatsapp: '+1-731-318-5331',
  contact_emails: 'sales@shantiboilers.com, info@shantiboilers.com',
  website: 'www.shantiboilers.com',
};

const DEFAULT = {
  // First company = the default for records with no company.
  companies: [
    {
      company: 'Shanti Boilers', legal_name: 'Shanti Boilers & Pressure Vessels (P) Ltd',
      gstin: '36AAECS7382N1ZN', pan: 'AAECS7382N',
      registered_address: 'P-10-10, I.D.A, Nacharam, Hyderabad - 500 056',
      state: 'Telangana', state_code: '36', invoice_prefix: 'SB',
      print_name: 'SHANTI BOILERS & PRESSURE VESSELS PVT LTD', phone: '27174042 / 27152164',
      ...CONTACT, stores_email: 'Stores@shantiboilers.com',
      tagline: 'HEATING SOLUTIONS', motto: 'TRUST • PERFORMANCE • EFFICIENCY', wordmark_tm: '1',
      maker_prefix: 'SB', qc_doc_prefix: 'SBH', qc_ref_prefix: 'SB/QC/OW',
      qc_address: '# P-10-10, IDA Nacharam, Hyderabad - 500076 Telangana, India.',
    },
    {
      company: 'Shanti Techno Fab', legal_name: 'Shanti Techno Fab',
      gstin: '36AAVCS1802J1Z1', pan: 'AAVCS1802J',
      registered_address: 'Survey No. 128/E3, Kuncharam Village, Toopran Mandal, Medak, Telangana - 502336',
      state: 'Telangana', state_code: '36', invoice_prefix: 'STF',
      print_name: 'SHANTI TECHNO FAB PVT LTD',
      ...CONTACT, // placeholder: same contacts as the first company until the client supplies its own
      maker_prefix: 'STF', qc_doc_prefix: 'STF', qc_ref_prefix: 'STF/QC/OW',
      qc_name: 'Shanti Techno Fab Pvt Ltd', qc_address: 'Kucharam, Hyderabad',
    },
    {
      company: 'Srivaari Agencies', legal_name: 'Srivaari Agencies',
      registered_address: 'Hyderabad, Telangana',
      state: 'Telangana', state_code: '36', invoice_prefix: 'SA',
      print_name: 'SRIVAARI AGENCIES',
    },
  ],
  emailTemplates: DEFAULT_TEMPLATES, // { [company]: { subject, body, regards } }
  // QC statutory folder: who the covering letter is addressed to by default.
  qcAuthority: {
    name: 'The Director of Boilers',
    designation: 'DIRECTORATE OF BOILERS, TELANGANA, HYDERABAD', // Form II(1) stamp authority
    address: ['H.No: 2-2-647/182/A, 3rd Floor,', 'Azam Complex, Shivam Road,', 'Bagh Amberpet,', 'Hyderabad - 13,', 'Telangana.'],
  },
  poCounterStart: 578,
};

function load() {
  if (!process.env.CUSTOMER_SEED) return DEFAULT;
  try { return { ...DEFAULT, emailTemplates: {}, ...JSON.parse(process.env.CUSTOMER_SEED) }; }
  catch (e) { throw new Error(`CUSTOMER_SEED is not valid JSON: ${e.message}`); }
}

export const CUSTOMER_SEED = load();
export const SEED_DEFAULT_COMPANY = CUSTOMER_SEED.companies[0].company;

// Document-detail columns on company_settings that the seed may fill (only where blank).
export const PROFILE_COLUMNS = ['print_name', 'phone', 'contact_mobile', 'contact_landline', 'contact_whatsapp', 'contact_emails',
  'website', 'stores_email', 'tagline', 'motto', 'wordmark_tm', 'maker_prefix', 'qc_doc_prefix', 'qc_ref_prefix', 'qc_name', 'qc_address'];
