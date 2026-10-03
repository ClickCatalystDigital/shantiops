// node lib/whatsapp-selfcheck.mjs
import assert from 'node:assert';
import crypto from 'crypto';
import { parseWebhook, windowOpen, signatureOk, templateInfo, fillTemplate, toWaId, sumUsage } from './whatsapp.mjs';

// Meta's own documented examples (webhooks reference, v25.0).
const incoming = { object: 'whatsapp_business_account', entry: [{ id: '1', changes: [{ value: {
  messaging_product: 'whatsapp', metadata: { display_phone_number: '15550783881', phone_number_id: '106540352242922' },
  contacts: [{ profile: { name: 'Sheena Nelson' }, wa_id: '16505551234' }],
  messages: [{ from: '16505551234', id: 'wamid.A', timestamp: '1749416383', type: 'text', text: { body: 'Does it come in another color?' } }] } }] }] };
const [ev] = parseWebhook(incoming);
assert.strictEqual(ev.phoneNumberId, '106540352242922');
assert.deepStrictEqual(ev.messages[0], { waMessageId: 'wamid.A', from: '16505551234', name: 'Sheena Nelson', type: 'text',
  body: 'Does it come in another color?', at: new Date(1749416383000).toISOString() });

const status = { object: 'whatsapp_business_account', entry: [{ changes: [{ value: { metadata: { phone_number_id: '1' },
  statuses: [{ id: 'wamid.B', status: 'failed', errors: [{ title: 'Re-engagement message', error_data: { details: 'More than 24 hours have passed' } }] }] } }] }] };
assert.deepStrictEqual(parseWebhook(status)[0].statuses[0], { waMessageId: 'wamid.B', status: 'failed', error: 'More than 24 hours have passed' });
assert.deepStrictEqual(parseWebhook({ object: 'page' }), [], 'other webhook objects are ignored');
const img = parseWebhook({ object: 'whatsapp_business_account', entry: [{ changes: [{ value: { metadata: { phone_number_id: '1' },
  messages: [{ from: '9', id: 'x', type: 'image', image: { caption: 'nameplate' } }] } }] }] });
assert.strictEqual(img[0].messages[0].body, '[photo] nameplate');

const now = Date.parse('2026-10-03T12:00:00Z');
assert.ok(windowOpen('2026-10-02 12:30:00', now), '23.5 h ago: open');
assert.ok(!windowOpen('2026-10-02 11:30:00', now), '24.5 h ago: closed');
assert.ok(!windowOpen(null, now), 'customer never wrote: closed');

const raw = '{"a":1}';
const sig = `sha256=${crypto.createHmac('sha256', 'secret').update(raw).digest('hex')}`;
assert.ok(signatureOk(raw, sig, 'secret'));
assert.ok(!signatureOk(raw, sig, 'other'));
assert.ok(!signatureOk(`${raw} `, sig, 'secret'), 'a changed body fails');

const t = templateInfo({ name: 'rfq_update', language: 'en', category: 'UTILITY', components: [{ type: 'BODY', text: 'Hello {{1}}, your order {{2}} is ready.' }] });
assert.strictEqual(t.params, 2);
assert.strictEqual(fillTemplate(t.body, ['Ravi', 'SB-1060']), 'Hello Ravi, your order SB-1060 is ready.');

assert.strictEqual(toWaId('98765 43210'), '919876543210');
assert.strictEqual(toWaId('+91-98765-43210'), '919876543210');
assert.strictEqual(toWaId(''), null);

const u = sumUsage([{ pricing_category: 'UTILITY', cost: 1.2, volume: 10 }, { pricing_category: 'SERVICE', pricing_type: 'FREE_CUSTOMER_SERVICE', cost: 0, volume: 40 }, { pricing_category: 'UTILITY', cost: 0.3, volume: 2 }]);
assert.strictEqual(u.messages, 52);
assert.strictEqual(u.free, 40);
assert.strictEqual(Math.round(u.cost * 100), 150);
assert.strictEqual(u.byCategory[0].category, 'UTILITY');
console.log('lib/whatsapp.mjs self-check: all assertions passed.');
