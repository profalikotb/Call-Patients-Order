import { handle, json, requireStaff, clinicParam } from '@/lib/server/http';
import { db } from '@/lib/server/db';
import { getClinic, getClinicSettings } from '@/lib/server/settings';
import { providersAvailable } from '@/lib/server/tts';
import { sheetSource } from '@/lib/server/sheets';
import { sessionDate } from '@/lib/server/session';
import { bookingsList } from '@/lib/server/bookings';
import { listStaffMsgs } from '@/lib/server/staffMsg';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const ORDER: Record<string, number> = { in_room: 0, called: 1, waiting: 2, booked: 3, postponed: 4, absent: 5, done: 6, cancelled: 7 };

export const GET = handle(async (req) => {
  const clinic = clinicParam(new URL(req.url).searchParams.get('clinic'));
  const me = await requireStaff({ clinic });
  const today = await sessionDate(clinic);
  const [c, settings, entries, day, display, last, blist, msgs, links] = await Promise.all([
    getClinic(clinic),
    getClinicSettings(clinic),
    db().from('queue_entries').select('*').eq('clinic_id', clinic).eq('service_date', today),
    db().from('queue_days').select('*').eq('clinic_id', clinic).eq('service_date', today).maybeSingle(),
    db().from('display_state').select('*').eq('clinic_id', clinic).maybeSingle(),
    db().from('audit_log').select('id,action,actor,created_at,entry_id').eq('clinic_id', clinic).eq('service_date', today)
      .eq('undone', false).neq('action', 'undo').order('id', { ascending: false }).limit(1),
    bookingsList(today),
    listStaffMsgs(clinic),
    db().from('booking_links').select('*').eq('clinic_id', clinic).eq('service_date', today).then((r) => r.data ?? [], () => []),
  ]);
  if (!c) return json({ ok: false, error: 'unknown_clinic' }, 404);
  if (entries.error) throw entries.error;
  const rows = entries.data ?? [];
  const books = new Map(blist.filter((x) => /^\d+$/.test(x.code)).map((x) => [x.code, x]));
  const oracleCodes = new Set(rows.map((r) => String(r.patient_code ?? '')).filter(Boolean));
  const linkBy = new Map<string, any>((links as any[]).map((l) => [l.entry_id, l]));
  const linkedSerials = new Set((links as any[]).map((l) => l.serial).filter(Boolean));

  // estimate = mean of real consultation durations today (in_room → done), recent 12, clamped
  const durs = rows.filter((r) => r.done_at && r.in_room_at)
    .sort((a, b) => +new Date(b.done_at) - +new Date(a.done_at)).slice(0, 12)
    .map((r) => (+new Date(r.done_at) - +new Date(r.in_room_at)) / 60000).filter((m) => m > 0.5 && m < 120);
  const avg = durs.length >= 3 ? durs.reduce((a, b) => a + b, 0) / durs.length
    : durs.length ? (durs.reduce((a, b) => a + b, 0) + settings.default_consult_minutes * (3 - durs.length)) / 3
    : settings.default_consult_minutes;
  const waiting = rows.filter((r) => r.status === 'waiting' && r.queue_number != null)
    .sort((a, b) => Number(a.sort_key ?? 1e9) - Number(b.sort_key ?? 1e9) || a.queue_number - b.queue_number);
  const busy = rows.some((r) => r.status === 'in_room' || r.status === 'called') ? 1 : 0;
  const pos = new Map(waiting.map((r, i) => [r.id, i]));
  const list = rows.map((r) => ({ ...r, position: pos.get(r.id) ?? null,
    // online booking with the SAME patient code → WhatsApp number + booked time (Oracle data is not changed)
    // booking: linked by hand (another name / serial) wins, else same patient code
    ...(() => {
      const l = linkBy.get(r.id); const bk = r.patient_code ? books.get(String(r.patient_code)) : undefined;
      if (l) return { wa_phone: l.b_phone || bk?.phone || null, booked_time: l.b_time || null, booked_serial: l.serial ?? null,
        booked_name: l.b_name && l.b_name !== r.patient_name ? l.b_name : null, booked_via: 'link' };
      return { wa_phone: bk?.phone || null, booked_time: bk?.time || null, booked_serial: bk?.serial ?? null, booked_name: null, booked_via: bk ? 'code' : null };
    })(),
    est_wait_min: pos.has(r.id) ? Math.round((pos.get(r.id)! + busy) * avg) : null }))
    .sort((a, b) => (ORDER[a.status] - ORDER[b.status]) ||
      (a.status === 'waiting' ? (a.position ?? 1e9) - (b.position ?? 1e9) : 0) ||
      ((a.queue_number ?? 1e9) - (b.queue_number ?? 1e9)) || String(a.appt_time).localeCompare(String(b.appt_time)));

  const count = (s: string) => rows.filter((r) => r.status === s).length;
  const d = display.data;
  return json({
    ok: true, today, clinic: c, role: me.role, policy: settings.policy, room_label: settings.room_label,
    voice: { includeName: settings.voice.includeName, provider: settings.voice.provider },
    day: day.data ?? { version: 0, paused: false, current_entry_id: null },
    entries: list,
    stats: { waiting: count('waiting'), booked: count('booked'), called: count('called'), in_room: count('in_room'),
      done: count('done'), absent: count('absent'), postponed: count('postponed'), cancelled: count('cancelled'),
      total: rows.length, avg_consult_min: Math.round(avg * 10) / 10, avg_samples: durs.length },
    next_number: waiting[0]?.queue_number ?? null,
    display: d ? { current_number: d.current_number, next_numbers: d.next_numbers, audio_ready: !!(d.audio_lease_until && new Date(d.audio_lease_until) > new Date()),
      audio_device_label: d.audio_device_label, announce: d.announce } : null,
    last_action: last.data?.[0] ?? null,
    // read-only guide: today's online bookings (in_list = same patient code already in Oracle's list)
    bookings: blist.map((x) => ({ ...x, in_list: oracleCodes.has(x.code) || linkedSerials.has(x.serial) })),
    messages: msgs.filter((m: any) => !m.ack_at),            // doctor → assistant, unread
    tts: providersAvailable(), sheet_source: sheetSource(), server_now: Date.now(),
  });
});
