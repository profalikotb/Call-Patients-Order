// End-of-clinic closing (admin only).  GET ?clinic=&date=   PUT {clinic, date, items}
import { handle, json, requireStaff, clinicParam, HttpError } from '@/lib/server/http';
import { db } from '@/lib/server/db';
import { calcClosing, EXPENSES, closingNum } from '@/lib/closing';
import { accountSheetOn, exportClosings } from '@/lib/server/accountSheet';
import { getFee } from '@/lib/server/fees';
import { payTotals } from '@/lib/payment';
export const maxDuration = 60;
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
const MISSING = 'Run supabase/migrations/017_day_closing.sql first';
const dd = (iso: string) => iso.split('-').reverse().join('/');

export const GET = handle(async (req) => {
  const u = new URL(req.url);
  const clinic = clinicParam(u.searchParams.get('clinic'));
  await requireStaff({ clinic, admin: true });
  const date = u.searchParams.get('date') || '';
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new HttpError(400, 'bad_date');
  const { data, error } = await db().from('day_closing').select('*').eq('clinic_id', clinic).eq('service_date', date).maybeSingle();
  if (error) throw new HttpError(500, /day_closing/.test(error.message) ? MISSING : error.message);
  return json({ ok: true, closing: data ?? null });
});

export const PUT = handle(async (req) => {
  const b = await req.json().catch(() => null);
  const clinic = clinicParam(String(b?.clinic || ''));
  const me = await requireStaff({ clinic, admin: true });
  const date = String(b?.date || '');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new HttpError(400, 'bad_date');
  const src = b?.items ?? {};
  const items: Record<string, number | string> = {
    no_cases: closingNum(src.no_cases), fees_back: closingNum(src.fees_back), fees: closingNum(src.fees),
    notes_other: String(src.notes_other ?? '').slice(0, 500), notes: String(src.notes ?? '').slice(0, 1000),
  };
  for (const [k] of EXPENSES) items[k] = closingNum(src[k]);
  // cases / refunds / fee always come from the live data (payments + fee of that day), not from the browser
  const [ents, pays, fee] = await Promise.all([
    db().from('queue_entries').select('id,procedure,status').eq('clinic_id', clinic).eq('service_date', date),
    db().from('entry_payments').select('entry_id,method').eq('clinic_id', clinic).eq('service_date', date).then((r) => r.data ?? [], () => []),
    getFee(clinic, date),
  ]);
  const pm = new Map((pays as any[]).map((p) => [p.entry_id, p.method]));
  const T = payTotals((ents.data ?? []).map((e: any) => ({ ...e, payment: pm.get(e.id) ?? 'fawry' })), fee);
  // a field edited by hand keeps the typed value; otherwise the live value is used
  const manual: Record<string, boolean> = {};
  const liveV: Record<string, number> = { no_cases: T.fawry + T.instapay + T.refund, fees_back: T.refund, fees: T.fee };
  for (const k of ['no_cases', 'fees_back', 'fees']) { if (src.manual?.[k]) manual[k] = true; else items[k] = liveV[k]; }
  (items as any).manual = manual;
  const c = calcClosing(items as any, dd(date));
  const { error } = await db().from('day_closing').upsert({ clinic_id: clinic, service_date: date, items, grand_net: c.grand_net, report: c.report,
    updated_by: me.name || me.sub, updated_at: new Date().toISOString() }, { onConflict: 'clinic_id,service_date' });
  if (error) throw new HttpError(500, /day_closing/.test(error.message) ? MISSING : error.message);
  // copy to Google Sheet «DailyClinicAcount» (if configured) – the closing is already saved even if this fails
  let sheet: any = null;
  if (accountSheetOn()) { try { sheet = { ok: true, ...(await exportClosings({ clinic, date })) }; } catch (e: any) { sheet = { ok: false, error: String(e?.message || e) }; } }
  return json({ ok: true, ...c, sheet });
});

// POST {all: true} (admin) → send every saved closing to the Google Sheet (first-time fill / repair)
export const POST = handle(async (req) => {
  await requireStaff({ admin: true });
  const b = await req.json().catch(() => ({}));
  if (!b?.all) throw new HttpError(400, 'bad_json');
  try { return json({ ok: true, ...(await exportClosings()) }); }
  catch (e: any) { throw new HttpError(500, String(e?.message || e)); }
});
