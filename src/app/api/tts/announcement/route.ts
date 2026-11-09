// Announcement audio by sequence number – used when "include name" is ON. Name never leaves the server as text.
import { handle, checkDisplayKey, clinicParam, HttpError, json } from '@/lib/server/http';
import { db } from '@/lib/server/db';
import { getClinicSettings } from '@/lib/server/settings';
import { speak, audioResponse } from '@/lib/server/tts';
import { renderAnnouncement } from '@/lib/announce';
import { sessionDate } from '@/lib/server/session';
import type { Variant } from '@/lib/config';
export const runtime = 'nodejs';

export const GET = handle(async (req) => {
  const u = new URL(req.url);
  checkDisplayKey(u.searchParams.get('k'));
  const clinic = clinicParam(u.searchParams.get('clinic'));
  const seq = Number(u.searchParams.get('seq'));
  const variant = (u.searchParams.get('variant') || 'call') as Variant;
  if (!Number.isInteger(seq) || seq < 1) throw new HttpError(400, 'bad_seq');
  const { data: a } = await db().from('announcements').select('queue_number, entry_id, kind')
    .eq('clinic_id', clinic).eq('service_date', await sessionDate(clinic)).eq('seq', seq).maybeSingle();
  if (!a?.queue_number) throw new HttpError(404, 'no_announcement');
  const s = await getClinicSettings(clinic);
  let name: string | null = null;
  if (s.voice.includeName && a.entry_id) {
    const { data: e } = await db().from('queue_entries').select('patient_name').eq('id', a.entry_id).maybeSingle();
    name = e?.patient_name ?? null;
  }
  try {
    const text = renderAnnouncement(s, a.queue_number, variant === 'repeat' ? 'repeat' : (a.kind as Variant), name);
    return audioResponse(await speak(text, s.voice, !name), 0);
  } catch (e: any) {
    return json({ ok: false, error: 'tts_unavailable', detail: String(e?.message || e) }, 503);
  }
});
