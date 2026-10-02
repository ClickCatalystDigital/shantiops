// app/api/sales/quotation-reminders/route.js — Sales CRM plan 2d. Machine-triggered daily by the
// cron Worker (workers/rate-sync-cron, REMINDERS_URL), same shared-secret header as the rate sync
// (x-sync-key = RATE_SYNC_KEY) since a cron has no session. The bell's read path also runs the
// same sweep at most hourly, so reminders still go out if the Worker isn't set up.
import { NextResponse } from 'next/server';
import { timingSafeEqual } from 'node:crypto';
import { sweepQuotationReminders } from '@/lib/quotation-reminders';
import { sweepRetentionNotice } from '@/lib/sales-retention';
import { sweepPaymentReminders } from '@/lib/payment-reminders';
import { sweepPlanAlerts } from '@/lib/plan-alerts';
import { sweepOrderAlerts } from '@/lib/order-alerts';

function authorized(req) {
  const key = Buffer.from(String(req.headers.get('x-sync-key') ?? ''));
  const want = Buffer.from(String(process.env.RATE_SYNC_KEY ?? ''));
  return want.length > 0 && key.length === want.length && timingSafeEqual(key, want);
}

export async function POST(req) {
  if (!authorized(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  try {
    const quotations = await sweepQuotationReminders();
    const payments = await sweepPaymentReminders();
    const retention = await sweepRetentionNotice();
    const orders = await sweepOrderAlerts().catch(() => ({ sent: 0, error: true }));
    // Planning: uncovered material for projects starting soon (one daily cron covers every sweep).
    const plan = await sweepPlanAlerts().catch(() => ({ planAlertsSent: 0, error: true }));
    return NextResponse.json({ ok: true, ...quotations, payments, retention, orders, plan });
  } catch (err) {
    return NextResponse.json({ ok: false, error: err.message }, { status: 500 });
  }
}
