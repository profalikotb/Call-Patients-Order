// PUBLIC (display-key) – numbers only, never names.
import { createHash } from 'node:crypto';
import { handle, json, checkDisplayKey, clinicParam } from '@/lib/server/http';
import { db } from '@/lib/server/db';
import { getClinic, getClinicSettings } from '@/lib/server/settings';
import { providersAvailable } from '@/lib/server/tts';
import { cairoDate } from '@/lib/time';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const GET = handle(async (req) => {
  const u = new URL(req.url);
  checkDisplayKey(u.searchParams.get('k'));
  const clinic = clinicParam(u.searchParams.get('clinic'));
  const [c, s, row] = await Promise.all([getClinic(clinic), getClinicSettings(clinic),
    db().from('display_state').select('*').eq('clinic_id', clinic).maybeSingle()]);
  if (!c) return json({ ok: false, error: 'unknown_clinic' }, 404);
  const d = row.data;
  const today = cairoDate();
  const fresh = d && d.service_date === today;
  const set = s.voice.style === 'formal' ? s.templates.formal : s.templates.standard;
  const h = createHash('sha1').update(JSON.stringify([s.voice, s.templates, s.room_label])).digest('hex').slice(0, 12);
  const p = providersAvailable();
  return json({
    ok: true, server_now: Date.now(), today, h,
    clinic: { id: c.id, name_ar: c.name_ar, name_en: c.name_en },
    state: {
      rev: d?.rev ?? 0, version: d?.version ?? 0,
      current_number: fresh ? d.current_number : null, current_status: fresh ? d.current_status : null,
      next_numbers: fresh ? d.next_numbers : [], waiting_count: fresh ? d.waiting_count : 0,
      paused: !!d?.paused, announce: fresh ? d.announce : null,
      room_label: d?.room_label ?? s.room_label,
      audio_device_id: d?.audio_device_id ?? null, audio_device_label: d?.audio_device_label ?? null,
      audio_lease_until: d?.audio_lease_until ?? null,
    },
    display: s.display,
    playback: {
      volume: s.voice.volume, repeatCount: s.voice.repeatCount, repeatDelaySec: s.voice.repeatDelaySec,
      chime: s.voice.chime, includeName: s.voice.includeName, numberStyle: s.voice.numberStyle,
      templates: set, room_label: s.room_label, server_tts: p.azure || p.elevenlabs,
    },
  });
});
