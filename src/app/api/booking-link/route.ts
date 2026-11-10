// Link / unlink a waiting-list patient to an online booking (another name allowed).
// POST {clinic, entry_id, serial}                     → from the bookings feed (if installed)
// POST {clinic, entry_id, serial, time, name, phone}  → typed by hand from «جدول الحجز»
// POST {clinic, entry_id, unlink: true}
import { handle, json, requireStaff, clinicParam, HttpError } from '@/lib/server/http';
import { db } from '@/lib/server/db';
import { sessionDate } from '@/lib/server/session';
import { bookingsList } from '@/lib/server/bookings';
export const runtime = 'nodejs';

const S = (v: unknown, n: number) => (v === null || v === undefined ? '' : String(v).trim().slice(0, n));
const wa = (raw: string) => { let d = raw.replace(/\D/g, ''); if (/^01\d{9}$/.test(d)) d = '2' + d; if (/^1\d{9}$/.test(d)) d = '20' + d; return /^201\d{9}$/.test(d) ? d : ''; };

export const POST = handle(async (req) => {
  const b = await req.json().catch(() => null);
  if (!b?.entry_id) throw new HttpError(400, 'bad_json');
  const clinic = clinicParam(String(b.clinic || ''));
  const me = await requireStaff({ clinic });
  const date = await sessionDate(clinic);
  const t = db().from('booking_links');
  const fail = (e: any) => { throw new HttpError(500, /booking_links/.test(String(e?.message)) ? 'Run supabase/migrations/015_booking_links.sql first' : String(e?.message || e)); };
  if (b.unlink) { const { error } = await t.delete().eq('entry_id', b.entry_id).eq('clinic_id', clinic); if (error) fail(error); return json({ ok: true }); }

  const serial = Number(b.serial) || null;
  const fromFeed = serial ? (await bookingsList(date)).find((x) => x.serial === serial) : undefined;
  const row = {
    entry_id: b.entry_id, clinic_id: clinic, service_date: date, serial,
    b_name: S(b.name, 120) || fromFeed?.name || null,
    b_time: S(b.time, 20) || fromFeed?.time || null,
    b_phone: wa(S(b.phone, 30)) || fromFeed?.phone || null,
    b_code: fromFeed?.code || null,
    created_by: me.name || me.sub,
  };
  if (!row.b_time && !row.serial) throw new HttpError(400, 'اكتب رقم الحجز أو الوقت');
  const { error } = await t.upsert(row, { onConflict: 'entry_id' });
  if (error) fail(error);
  return json({ ok: true, link: row });
});
