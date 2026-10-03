// Plain-language explanations for the customer portal's "About your order" overlay. No jargon:
// each stage says, in one or two sentences, what is happening and what (if anything) the customer does.
export const STAGE_EXPLAIN = {
  order: 'We have received your order and opened a project for it.',
  design: 'Our engineers design your equipment and prepare the drawings. When drawings are ready you can review and approve them here — your approval lets us move ahead.',
  procurement: 'We order the steel, tubes, valves and other materials your equipment is made from.',
  manufacturing: 'Your equipment is being built in our workshop, one step at a time.',
  testing: 'Our quality team checks each step of the build before the next one starts. This includes the pressure (hydro) test.',
  documentation: 'We prepare the quality and inspection papers for your equipment, including the test certificates. They appear here once they are complete.',
  packing: 'Finished items are packed and labelled, ready to be sent to you.',
  pending: 'Some items in your order have not been sent yet. The list shows what is still to come. When they are ready, they go through Packing again.',
  installation: 'Our service team visits your site to install the equipment.',
  commissioning: 'We start up and test your equipment at your site and hand it over, with a commissioning report.',
};

// One sentence for the top of the overlay: where the order is right now.
export function currentSummary(phases) {
  const waiting = phases.find(p => p.status === 'awaiting_customer');
  if (waiting) return { title: 'We need your approval', body: 'Drawings are waiting for your review. Once you approve them, we can carry on.' };
  const steps = phases.filter(p => p.key !== 'pending');
  if (steps.every(p => p.status === 'done')) return { title: 'Your order is complete', body: 'Everything has been delivered and handed over. Thank you for choosing us.' };
  const live = steps.filter(p => p.status === 'in_progress');
  if (live.length) {
    const names = live.map(p => p.label);
    // Several stages can run side by side (e.g. procurement while the workshop builds) — say so,
    // instead of explaining only one of them.
    return { title: `Now: ${names.join(' · ')}`, body: live.length > 1 ? 'Different parts of your order are moving at the same time. Each stage is explained below.' : STAGE_EXPLAIN[live[0].key] || '' };
  }
  const next = steps.find(p => p.status !== 'done');
  return { title: `Next: ${next.label}`, body: STAGE_EXPLAIN[next.key] || '' };
}
