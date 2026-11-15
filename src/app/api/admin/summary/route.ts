import { handle, json, requireStaff, clinicParam, HttpError } from '@/lib/server/http';
import { db } from '@/lib/server/db';
import { cairoDate } from '@/lib/time';
import { getFee } from '@/lib/server/fees';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const GET = handle(async (req) => {
  const u = new URL(req.url);
  const clinic = clinicParam(u.searchParams.get('clinic'));
  const me = await requireStaff({ clinic });
  const date = u.searchParams.get('date') || cairoDate();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new HttpError(400, 'bad_date');
  const [e, a, an, pay] = await Promise.all([
    db().from('queue_entries').select('id,queue_number,patient_name,patient_code,procedure,appt_time,status,source,called_count,called_at,in_room_at,done_at,priority')
      .eq('clinic_id', clinic).eq('service_date', date).order('queue_number', { nullsFirst: false }),
    db().from('audit_log').select('id,action,actor,entry_id,args,undone,created_at,result')
      .eq('clinic_id', clinic).eq('service_date', date).order('id', { ascending: false }).limit(300),
    db().from('announcements').select('seq,queue_number,kind,silent,created_at,played_at,created_by')
      .eq('clinic_id', clinic).eq('service_date', date).order('seq', { ascending: false }).limit(300),
    db().from('entry_payments').select('entry_id,method').eq('clinic_id', clinic).eq('service_date', date).then((r) => r.data ?? [], () => []),
  ]);
  const payBy = new Map<string, string>((pay as any[]).map((p) => [p.entry_id, p.method]));
  const rows = (e.data ?? []).map((r) => ({ ...r, payment: payBy.get(r.id) ?? 'fawry' }));
  const by: Record<string, number> = {};
  rows.forEach((r) => { by[r.status] = (by[r.status] ?? 0) + 1; });
  // consultation time = from «نداء» to the patient leaving the Oracle list (done)
  const durs = rows.filter((r) => r.done_at && (r.called_at || r.in_room_at)).map((r) => (+new Date(r.done_at) - +new Date(r.called_at || r.in_room_at)) / 60000);
  const waits = rows.filter((r) => r.called_at && r.appt_time).length;
  return json({ ok: true, date, by, total: rows.length, walkins: rows.filter((r) => r.source === 'walkin').length,
    role: me.role, fee: me.role === 'admin' ? await getFee(clinic) : null, avg_consult: durs.length ? Math.round((durs.reduce((x, y) => x + y, 0) / durs.length) * 10) / 10 : null, waits,
    entries: rows, audit: a.data ?? [], announcements: an.data ?? [] });
});

// DELETE ?clinic=&date=  (admin only) – wipe one clinic day: patients, calls, edit log, booking links.
// Oracle is not touched: patients still in Oracle for that date come back on the next push.
export const DELETE = handle(async (req) => {
  const u = new URL(req.url);
  const clinic = clinicParam(u.searchParams.get('clinic'));
  await requireStaff({ clinic, admin: true });
  const date = u.searchParams.get('date') || '';
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new HttpError(400, 'bad_date');
  const d = db();
  const where = (t: string) => d.from(t).delete().eq('clinic_id', clinic).eq('service_date', date);
  for (const t of ['announcements', 'audit_log', 'booking_links', 'entry_payments', 'queue_entries', 'queue_days']) {
    const { error } = await where(t);
    if (error && !/booking_links|entry_payments/.test(error.message)) throw new HttpError(500, `${t}: ${error.message}`);
  }
  await d.rpc('refresh_display', { p_clinic: clinic, p_date: date });            // TV shows the empty day
  return json({ ok: true, cleared: { clinic, date } });
});
