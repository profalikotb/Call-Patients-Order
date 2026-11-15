// GET ?month=2026-11 (admin) → per clinic, per day: patients, كشف/استشارة, payments, revenue, expenses, net
//                              + the previous month totals for comparison.
import { handle, json, requireStaff, HttpError } from '@/lib/server/http';
import { db } from '@/lib/server/db';
import { getClinics } from '@/lib/server/settings';
import { feeResolver } from '@/lib/server/fees';
import { payTotals, isKashf } from '@/lib/payment';
import { calcClosing } from '@/lib/closing';
import { cairoDate } from '@/lib/time';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const monthRange = (m: string) => {
  const [y, mo] = m.split('-').map(Number);
  const end = new Date(Date.UTC(y, mo, 0)).getUTCDate();
  return { from: `${m}-01`, to: `${m}-${String(end).padStart(2, '0')}` };
};
const prevMonth = (m: string) => { const [y, mo] = m.split('-').map(Number); const d = new Date(Date.UTC(y, mo - 2, 1)); return d.toISOString().slice(0, 7); };

async function rowsIn(table: string, cols: string, from: string, to: string) {
  const out: any[] = [];
  for (let i = 0; ; i += 1000) {
    const { data, error } = await db().from(table).select(cols).gte('service_date', from).lte('service_date', to).range(i, i + 999);
    if (error) { if (/does not exist|schema cache/.test(error.message)) return out; throw new Error(`${table}: ${error.message}`); }
    out.push(...(data ?? [])); if (!data || data.length < 1000) return out;
  }
}

async function build(month: string, fee: (c: string, d: string) => number) {
  const { from, to } = monthRange(month);
  const [ents, pays, closes] = await Promise.all([
    rowsIn('queue_entries', 'id,clinic_id,service_date,procedure,status,called_at,in_room_at,done_at', from, to),
    rowsIn('entry_payments', 'entry_id,method', from, to),
    rowsIn('day_closing', 'clinic_id,service_date,items,grand_net', from, to),
  ]);
  const payBy = new Map(pays.map((p) => [p.entry_id, p.method]));
  const closeBy = new Map(closes.map((c) => [`${c.clinic_id}|${String(c.service_date).slice(0, 10)}`, c]));
  const groups = new Map<string, any[]>();
  for (const e of ents) { const k = `${e.clinic_id}|${String(e.service_date).slice(0, 10)}`; (groups.get(k) ?? groups.set(k, []).get(k)!).push({ ...e, payment: payBy.get(e.id) ?? 'fawry' }); }
  for (const k of closeBy.keys()) if (!groups.has(k)) groups.set(k, []);
  const days = [...groups.entries()].map(([k, rows]) => {
    const [clinic, date] = k.split('|');
    const real = rows.filter((r) => r.status !== 'cancelled');
    const cl = closeBy.get(k);
    const T = payTotals(rows, cl ? Number(cl.items?.fees) || fee(clinic, date) : fee(clinic, date));
    const c = cl ? calcClosing(cl.items ?? {}, date) : null;
    const durs = rows.filter((r) => r.done_at && (r.called_at || r.in_room_at)).map((r) => (+new Date(r.done_at) - +new Date(r.called_at || r.in_room_at)) / 60000).filter((m) => m > 0.5 && m < 120);
    return {
      clinic, date, patients: real.length, kashf: real.filter((r) => isKashf(r.procedure)).length,
      istishara: real.filter((r) => /استشار/.test(r.procedure ?? '')).length, done: rows.filter((r) => r.status === 'done').length,
      cash: T.fawry, instapay: T.instapay, refund: T.refund, fee: T.fee,
      revenue: c ? c.net_fees : T.total, expenses: c ? c.exp : 0, net: c ? c.grand_net : T.total, closed: !!cl,
      consult_min: durs.length ? Math.round((durs.reduce((a, b) => a + b, 0) / durs.length) * 10) / 10 : null, consult_n: durs.length,
    };
  }).sort((a, b) => a.date.localeCompare(b.date) || a.clinic.localeCompare(b.clinic));
  return days;
}

function totals(days: any[]) {
  const s = (k: string) => days.reduce((t, d) => t + (Number(d[k]) || 0), 0);
  const cn = s('consult_n');
  return { days: days.length, patients: s('patients'), kashf: s('kashf'), istishara: s('istishara'), done: s('done'),
    cash: s('cash'), instapay: s('instapay'), refund: s('refund'), revenue: s('revenue'), expenses: s('expenses'), net: s('net'),
    unclosed: days.filter((d) => !d.closed).length,
    consult_min: cn ? Math.round((days.reduce((t, d) => t + (d.consult_min ?? 0) * d.consult_n, 0) / cn) * 10) / 10 : null };
}

export const GET = handle(async (req) => {
  await requireStaff({ admin: true });
  const month = new URL(req.url).searchParams.get('month') || cairoDate().slice(0, 7);
  if (!/^\d{4}-\d{2}$/.test(month)) throw new HttpError(400, 'bad_month');
  const [fee, clinics] = await Promise.all([feeResolver(), getClinics()]);
  const [days, prev] = await Promise.all([build(month, fee), build(prevMonth(month), fee)]);
  const ids = [...new Set([...days, ...prev].map((d) => d.clinic))];
  const byClinic = Object.fromEntries(ids.map((id) => [id, { now: totals(days.filter((d) => d.clinic === id)), prev: totals(prev.filter((d) => d.clinic === id)) }]));
  return json({ ok: true, month, prev_month: prevMonth(month), clinics: clinics.map((c) => ({ id: c.id, name: c.name_ar })),
    days, all: { now: totals(days), prev: totals(prev) }, by_clinic: byClinic });
});
