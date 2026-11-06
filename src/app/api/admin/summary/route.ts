import { handle, json, requireStaff, clinicParam, HttpError } from '@/lib/server/http';
import { db } from '@/lib/server/db';
import { cairoDate } from '@/lib/time';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const GET = handle(async (req) => {
  const u = new URL(req.url);
  const clinic = clinicParam(u.searchParams.get('clinic'));
  await requireStaff({ clinic });
  const date = u.searchParams.get('date') || cairoDate();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new HttpError(400, 'bad_date');
  const [e, a, an] = await Promise.all([
    db().from('queue_entries').select('queue_number,patient_name,appt_time,status,source,called_count,called_at,in_room_at,done_at,priority')
      .eq('clinic_id', clinic).eq('service_date', date).order('queue_number', { nullsFirst: false }),
    db().from('audit_log').select('id,action,actor,entry_id,args,undone,created_at,result')
      .eq('clinic_id', clinic).eq('service_date', date).order('id', { ascending: false }).limit(300),
    db().from('announcements').select('seq,queue_number,kind,silent,created_at,played_at,created_by')
      .eq('clinic_id', clinic).eq('service_date', date).order('seq', { ascending: false }).limit(300),
  ]);
  const rows = e.data ?? [];
  const by: Record<string, number> = {};
  rows.forEach((r) => { by[r.status] = (by[r.status] ?? 0) + 1; });
  const durs = rows.filter((r) => r.done_at && r.in_room_at).map((r) => (+new Date(r.done_at) - +new Date(r.in_room_at)) / 60000);
  const waits = rows.filter((r) => r.called_at && r.appt_time).length;
  return json({ ok: true, date, by, total: rows.length, walkins: rows.filter((r) => r.source === 'walkin').length,
    avg_consult: durs.length ? Math.round((durs.reduce((x, y) => x + y, 0) / durs.length) * 10) / 10 : null, waits,
    entries: rows, audit: a.data ?? [], announcements: an.data ?? [] });
});
