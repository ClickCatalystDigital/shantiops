// lib/email-template-defaults.mjs — the standard Commercial Offer email per company: intro, the
// Terms and Conditions block, commercial + bank details and the closing. Body and signature are kept
// apart because the send dialog joins them (body, blank line, regards). Tokens: {{customer_name}},
// {{quotation_no}}, {{total}}, {{valid_until}}.
const COMMON_TERMS = (erection) => `Terms and Conditions :

PRICE: Above quoted price is at our Ex-works basis.
TAXES: GST @ 18 % Extra
PACKING & FORWARDING: Included
INSURANCE: Extra at actual if needed by the client
FREIGHT: To pay extra at actual
ERECTION & COMMISSIONING SUPERVISION: We shall depute our Engineer towards guidance for Mechanical Installation & Commissioning. Your good selves will have to arrange for to & fro boarding & lodging, local conveyance for each of his visits, plus a one time lumpsum charge of Rs ${erection}/- to be paid after commissioning.
PAYMENT: for Supply 50% advance balance against PI before dispatch and Labor 50% advance and balance on completion of work.
DELIVERY: 10-12 Weeks for supply and 6-8 weeks for undertaken the site work
WARRANTY: Offered equipment is guaranteed against all manufacturing defects and faulty workmanship for one year
VALIDITY: This offer is valid for 30 DAYS from the date of submission of offer`;

const INTRO = 'Dear {{customer_name}},\n\nPlease find attached our commercial offer {{quotation_no}}, valid until {{valid_until}}, for a total of {{total}}.\n\n';
const CLOSING = 'In case you need any further clarification, or want to know more about us, please feel free to contact us. We would be glad to call on you for further discussions.\n\nThanking you and assuring of our best services at all times.';
const DESK = 'Marketing Desk\n9071118080 Ext. 1\n9490494915';

export const DEFAULT_TEMPLATES = {
  'Shanti Boilers': {
    subject: 'Commercial Offer — {{quotation_no}}',
    body: `${INTRO}${COMMON_TERMS('20000')}

COMMERCIAL DETAILS:-

NAME : SHANTI BOILERS & PRESSURE VESSELS P LTD
P-10-10, IDA, NACHARAM, ROAD NO -HYDERABAD – TELANGANA- 76
GST : 36AAECS7382N1ZN

BANK DETAILS OF SHANTI BOILERS :
A/C NAME : SHANTI BOILERS & PRESSURE VESSELS PVT. LTD.
BANKER : KOTAK MAHINDRA BANK
BANK A/C NO. : 4550830674
BRANCH : SP Road, Secunderabad
BANK RTGS CODE : KKBK0007456

${CLOSING}`,
    regards: `Yours Faithfully,\n\nFor Shanti Boilers & Pressure Vessels Pvt.Ltd\n\n${DESK}`,
  },
  'Shanti Techno Fab': {
    subject: 'Commercial Offer — {{quotation_no}}',
    body: `${INTRO}${COMMON_TERMS('25000')}

COMMERCIAL DETAILS:-

NAME : SHANTI TECHNO FAB PVT LTD
P-10/10, IDA, Nacharam, Hyderabad - 500076
GST : 36AAVCS1802J1Z1

BANK DETAILS OF SHANTI TECHNO FAB :
A/C NAME : SHANTI TECHNO FAB PVT. LTD.
BANKER : KOTAK MAHINDRA BANK
BANK A/C NO. : 4550830650
BRANCH: 1-7-1, T. Subbarami Reddy Complex, SP Road, Secunderabad-500003, Telangana, India
BANK RTGS CODE : KKBK0007456

${CLOSING}`,
    regards: `Yours Faithfully,\n\nFor Shanti Techno Fab Pvt Ltd\n\n${DESK}`,
  },
};
