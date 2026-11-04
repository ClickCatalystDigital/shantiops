// Public demo entry (DEMO_MODE=1 only): a short form, then the visitor picks a department to enter as.
import { cookies } from 'next/headers';
import { notFound } from 'next/navigation';
import { DEMO_ROLES } from '@/lib/demo-roles';
import DemoEntry from '@/components/DemoEntry';
import { DEMO_VIDEO } from '@/lib/demo-video';
import { isOwnerPass } from '@/lib/demo-leads';
import { FEATURES, FEATURE_DETAILS } from '@/lib/product-features';

export const metadata = {
  title: 'Boiler Manufacturing ERP: Live Demo | SB Ops by Ahrom Labs',
  description: 'Try SB Ops, the ERP built for boiler and pressure-vessel manufacturers: enquiry to dispatch, BOM, procurement, stores, production job cards, IBR documents, GST accounts and service.',
  robots: { index: true, follow: true },
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
    url: 'https://boiler-erp.ahromlabs.com/demo',
    description: metadata.description,
    featureList: FEATURES.map(([, title, text]) => `${title}: ${text}`),
    publisher: { '@type': 'Organization', name: 'Ahrom Labs', url: 'https://ahromlabs.com' },
    hasPart: FEATURES.map(([, title]) => ({ '@type': 'WebPageElement', name: FEATURE_DETAILS[title].heading, url: `https://boiler-erp.ahromlabs.com/demo#${FEATURE_DETAILS[title].id}` })),
  };
  // The tour embedded above the form (lib/demo-video.js), for video results in search.
  const video = DEMO_VIDEO && {
    '@context': 'https://schema.org',
    '@type': 'VideoObject',
    name: DEMO_VIDEO.name,
    description: DEMO_VIDEO.description,
    thumbnailUrl: `https://i.ytimg.com/vi/${DEMO_VIDEO.id}/maxresdefault.jpg`,
    uploadDate: DEMO_VIDEO.uploadDate,
    duration: DEMO_VIDEO.duration,
    contentUrl: `https://www.youtube.com/watch?v=${DEMO_VIDEO.id}`,
    embedUrl: `https://www.youtube.com/embed/${DEMO_VIDEO.id}`,
    publisher: jsonLd.publisher,
  };
  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(video ? [jsonLd, video] : jsonLd).replace(/</g, '\\u003c') }} />
      <DemoEntry roles={DEMO_ROLES} hasLead={hasLead} isOwner={isOwnerPass(lead)} />
    </>
  );
}
