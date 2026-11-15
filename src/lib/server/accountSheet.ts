// Daily closing → Google Sheet «DailyClinicAcount» (apps-script/ClinicAccount.gs web app). One row per clinic per day.
// Vercel env: ACCOUNT_SHEET_URL (/exec URL) + ACCOUNT_SHEET_TOKEN (from setup()).
import { db } from './db';
import { clean } from '../envClean';
import { getClinics } from './settings';
import { calcClosing, EXPENSES } from '@/lib/closing';
import { payTotals } from '@/lib/payment';

export const accountSheetOn = () => !!(clean(process.env.ACCOUNT_SHEET_URL) && clean(process.env.ACCOUNT_SHEET_TOKEN));

async function rowFor(cl: any, clinicName: string) {
  const date = String(cl.service_date).slice(0, 10);
  const it = cl.items ?? {};
  const c = calcClosing(it, date.split('-').reverse().join('/'));
  const [e, p] = await Promise.all([
    db().from('queue_entries').select('id,procedure,status').eq('clinic_id', cl.clinic_id).eq('service_date', date),
    db().from('entry_payments').select('entry_id,method').eq('clinic_id', cl.clinic_id).eq('service_date', date),
  ]);
  const pay = new Map((p.data ?? []).map((x: any) => [x.entry_id, x.method]));
  const rows = (e.data ?? []).map((r: any) => ({ ...r, payment: pay.get(r.id) ?? 'fawry' }));
  const T = payTotals(rows, Number(it.fees) || 0);
  const r: Record<string, any> = {
    clinic_id: cl.clinic_id, clinic: clinicName, date,
    no_cases: Number(it.no_cases) || 0, fees_back: Number(it.fees_back) || 0, fees: Number(it.fees) || 0,
    net_number: c.net_number, net_fees: c.net_fees, exp: c.exp, grand_net: c.grand_net, report: c.report,
    notes_other: it.notes_other ?? '', notes: it.notes ?? '',
    cash: T.fawry, instapay: T.instapay, refund: T.refund,
    istishara: rows.filter((x: any) => x.status !== 'cancelled' && /استشار/.test(x.procedure ?? '')).length,
    saved_by: cl.updated_by ?? '', saved_at: cl.updated_at,
  };
  for (const [k] of EXPENSES) r[k] = Number(it[k]) || 0;
  return r;
}

async function post(rows: any[]) {
  const res = await fetch(clean(process.env.ACCOUNT_SHEET_URL), {
    method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' },          // text/plain: no CORS preflight; Apps Script follows the redirect
    body: JSON.stringify({ token: clean(process.env.ACCOUNT_SHEET_TOKEN), rows }), redirect: 'follow', signal: AbortSignal.timeout(25000),
  });
  const j: any = await res.json().catch(() => ({ ok: false, error: `HTTP ${res.status} (not JSON – check the /exec URL and «Who has access: Anyone»)` }));
  if (!j.ok) throw new Error(j.error || 'sheet_failed');
  return j as { ok: true; added: number; updated: number };
}

/** export one or all saved closings; returns {added, updated, n} */
export async function exportClosings(filter?: { clinic: string; date: string }) {
  if (!accountSheetOn()) throw new Error('ACCOUNT_SHEET_URL / ACCOUNT_SHEET_TOKEN not set in Vercel');
  let q = db().from('day_closing').select('*').order('service_date');
  if (filter) q = q.eq('clinic_id', filter.clinic).eq('service_date', filter.date);
  const { data, error } = await q;
  if (error) throw new Error(error.message);
  const names = new Map((await getClinics()).map((c) => [c.id, c.name_ar]));
  const rows = [];
  for (const cl of data ?? []) rows.push(await rowFor(cl, names.get(cl.clinic_id) ?? cl.clinic_id));
  let added = 0, updated = 0;
  for (let i = 0; i < rows.length; i += 60) { const r = await post(rows.slice(i, i + 60)); added += r.added; updated += r.updated; }
  return { n: rows.length, added, updated };
}
