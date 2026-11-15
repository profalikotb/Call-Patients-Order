// POST {clinic, entry_id, method: 'fawry'|'instapay'|'refund'}  – كاش ('fawry' key) is the default (stored as no row)
// Every change is logged (payment_log); «تم رد الكشف» sends a phone alert to the doctor;
// after the day closing is saved only the admin can change payments.
import { after } from 'next/server';
import { handle, json, requireStaff, clinicParam, HttpError } from '@/lib/server/http';
import { db } from '@/lib/server/db';
import { PAY, PAY_DEFAULT, payOf } from '@/lib/payment';
import { phoneAlert } from '@/lib/server/alert';
export const runtime = 'nodejs';

export const POST = handle(async (req) => {
  const b = await req.json().catch(() => null);
  if (!b?.entry_id || !['fawry', 'instapay', 'refund'].includes(b?.method)) throw new HttpError(400, 'bad_json');
  const clinic = clinicParam(String(b.clinic || ''));
  const me = await requireStaff({ clinic });
  const d = db();
  const ent = await d.from('queue_entries').select('id,service_date,patient_name,patient_code,procedure,status').eq('id', b.entry_id).eq('clinic_id', clinic).maybeSingle();
  if (!ent.data) throw new HttpError(404, 'not_found');
  const date = ent.data.service_date;
  if (me.role !== 'admin') {
    const closed = await d.from('day_closing').select('clinic_id').eq('clinic_id', clinic).eq('service_date', date).maybeSingle();
    if (closed.data) throw new HttpError(403, 'تم تقفيل اليوم – التعديل للطبيب فقط');
  }
  const prev = await d.from('entry_payments').select('method').eq('entry_id', b.entry_id).maybeSingle();
  const from = payOf(prev.data?.method);
  const method = payOf(b.method);
  if (from === method) return json({ ok: true, method, unchanged: true });
  const t = d.from('entry_payments');
  const fail = (e: any) => { throw new HttpError(500, /entry_payments/.test(String(e?.message)) ? 'Run supabase/migrations/016_payments.sql first' : String(e?.message || e)); };
  const { error } = method === PAY_DEFAULT
    ? await t.delete().eq('entry_id', b.entry_id)
    : await t.upsert({ entry_id: b.entry_id, clinic_id: clinic, service_date: date, method, set_by: me.name || me.sub, set_at: new Date().toISOString() }, { onConflict: 'entry_id' });
  if (error) fail(error);
  const who = me.name || me.sub;
  after(async () => {
    await d.from('payment_log').insert({ clinic_id: clinic, service_date: date, entry_id: b.entry_id, patient_name: ent.data!.patient_name,
      patient_code: ent.data!.patient_code ?? null, from_method: from, to_method: method, actor: who, actor_role: me.role }).then(() => {}, () => {});
    if ((method === 'refund' || from === 'refund') && me.role !== 'admin')
      await phoneAlert(method === 'refund' ? '↩ تم رد كشف' : 'إلغاء رد كشف',
        `${ent.data!.patient_name ?? ''}${ent.data!.patient_code ? ' (' + ent.data!.patient_code + ')' : ''}\nمن «${PAY[from].ar}» إلى «${PAY[method].ar}»\nبواسطة: ${who}`, { tags: 'money_with_wings', priority: 4 });
  });
  return json({ ok: true, method });
});
