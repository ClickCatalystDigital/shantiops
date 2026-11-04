// Public demo entry (DEMO_MODE=1 only): a short form, then the visitor picks a department to enter as.
import { IS_US } from '@/lib/market';
import { cookies } from 'next/headers';
import { notFound } from 'next/navigation';
import { DEMO_ROLES } from '@/lib/demo-roles';
import DemoEntry from '@/components/DemoEntry';
import { isOwnerPass } from '@/lib/demo-leads';
import { FEATURES, FEATURE_DETAILS } from '@/lib/product-features';

// The demo's public address (wrangler.jsonc / wrangler.us.jsonc routes).
const DEMO_ORIGIN = IS_US ? 'https://boiler-erp-us.ahromlabs.com' : 'https://boiler-erp.ahromlabs.com';

export const metadata = {
  title: IS_US
    ? 'Boiler and Pressure Vessel ERP for US Fabricators: Live Demo | SB Ops by Ahrom Labs'
    : 'Boiler Manufacturing ERP: Live Demo | SB Ops by Ahrom Labs',
  description: IS_US
    ? 'Try SB Ops, the ERP built for boiler and pressure-vessel manufacturers: inquiry to shipping, BOM, procurement, receiving, production job cards, ASME data reports, accounts and service.'
    : 'Try SB Ops, the ERP built for boiler and pressure-vessel manufacturers: enquiry to dispatch, BOM, procurement, stores, production job cards, IBR documents, GST accounts and service.',
  robots: { index: true, follow: true },
  // One URL per demo (/ only redirects here), and the India and US builds named as each other's regional versions.
  alternates: {
    canonical: `${DEMO_ORIGIN}/demo`,
    languages: { 'en-IN': 'https://boiler-erp.ahromlabs.com/demo', 'en-US': 'https://boiler-erp-us.ahromlabs.com/demo', 'x-default': 'https://boiler-erp.ahromlabs.com/demo' },
  },
};

export default async function DemoPage() {
  if (process.env.DEMO_MODE !== '1') notFound();
  const lead = (await cookies()).get('demo_lead')?.value;
  const hasLead = !!lead;
  // Structured data for search engines: what the product is and what it does (the same text as the page).
  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'SoftwareApplication',
    name: 'SB Ops',
    applicationCategory: 'BusinessApplication',
    applicationSubCategory: 'ERP for boiler and pressure-vessel manufacturers',
    operatingSystem: 'Web browser',
    url: `${DEMO_ORIGIN}/demo`,
    description: metadata.description,
    featureList: FEATURES.map(([, title, text]) => `${title}: ${text}`),
    publisher: { '@type': 'Organization', name: 'Ahrom Labs', url: 'https://ahromlabs.com' },
    hasPart: FEATURES.map(([, title]) => ({ '@type': 'WebPageElement', name: FEATURE_DETAILS[title].heading, url: `${DEMO_ORIGIN}/demo#${FEATURE_DETAILS[title].id}`})),
  };
  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd).replace(/</g, '\\u003c') }} />
      <DemoEntry roles={DEMO_ROLES} hasLead={hasLead} isOwner={isOwnerPass(lead)} />
    </>
  );
}
