// POST {clinic, entry_id, method: 'fawry'|'instapay'|'refund'}  – فوري is the default (stored as no row)
import { handle, json, requireStaff, clinicParam, HttpError } from '@/lib/server/http';
import { db } from '@/lib/server/db';
import { PAY_DEFAULT, payOf } from '@/lib/payment';
export const runtime = 'nodejs';

export const POST = handle(async (req) => {
  const b = await req.json().catch(() => null);
  if (!b?.entry_id || !['fawry', 'instapay', 'refund'].includes(b?.method)) throw new HttpError(400, 'bad_json');
  const clinic = clinicParam(String(b.clinic || ''));
  const me = await requireStaff({ clinic });
  const d = db();
  const ent = await d.from('queue_entries').select('id,service_date').eq('id', b.entry_id).eq('clinic_id', clinic).maybeSingle();
  if (!ent.data) throw new HttpError(404, 'not_found');
  const t = d.from('entry_payments');
  const fail = (e: any) => { throw new HttpError(500, /entry_payments/.test(String(e?.message)) ? 'Run supabase/migrations/016_payments.sql first' : String(e?.message || e)); };
  const method = payOf(b.method);
  const { error } = method === PAY_DEFAULT
    ? await t.delete().eq('entry_id', b.entry_id)
    : await t.upsert({ entry_id: b.entry_id, clinic_id: clinic, service_date: ent.data.service_date, method, set_by: me.name || me.sub, set_at: new Date().toISOString() }, { onConflict: 'entry_id' });
  if (error) fail(error);
  return json({ ok: true, method });
});
