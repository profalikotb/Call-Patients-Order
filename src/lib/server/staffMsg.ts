// Doctor → assistant quick messages (migration 013). Sending nudges every open reception page through
// the display_state realtime channel, so the banner appears within ~1 s.
import { db, rpc } from './db';
import { sessionDate } from './session';

export async function sendStaffMsg(clinic: string, body: string, from: string) {
  const text = body.trim().slice(0, 300);
  if (!text) throw new Error('empty');
  const { data, error } = await db().from('staff_messages').insert({ clinic_id: clinic, body: text, from_label: from.slice(0, 60) }).select().single();
  if (error) throw new Error(/staff_messages/.test(error.message) ? 'Run supabase/migrations/013_staff_messages.sql first' : error.message);
  await rpc('refresh_display', { p_clinic: clinic, p_date: await sessionDate(clinic) }).catch(() => {});   // realtime nudge
  return data;
}

/** unread messages + the last 10 (read or not) of the past 12 hours */
export async function listStaffMsgs(clinic: string) {
  const since = new Date(Date.now() - 12 * 3600_000).toISOString();
  const { data, error } = await db().from('staff_messages').select('*').eq('clinic_id', clinic).gt('created_at', since)
    .order('created_at', { ascending: false }).limit(20);
  if (error) return [];
  return data ?? [];
}

export async function ackStaffMsg(clinic: string, id: number, by: string) {
  await db().from('staff_messages').update({ ack_at: new Date().toISOString(), ack_by: by.slice(0, 60) })
    .eq('clinic_id', clinic).eq('id', id).is('ack_at', null);
  await rpc('refresh_display', { p_clinic: clinic, p_date: await sessionDate(clinic) }).catch(() => {});
}

const VOICE_BUCKET = 'staff-voice';
let voiceBucketReady = false;

/** voice note (≤ 2 MB, ≤ ~60 s) → private storage + a message «🎤 رسالة صوتية» */
export async function sendStaffVoice(clinic: string, audio: Buffer, type: string, from: string) {
  if (!audio.length || audio.length > 2_000_000) throw new Error('voice note empty or too long');
  const s = db().storage;
  if (!voiceBucketReady) { const { data } = await s.getBucket(VOICE_BUCKET); if (!data) await s.createBucket(VOICE_BUCKET, { public: false }); voiceBucketReady = true; }
  const ext = /mp4|m4a|aac/.test(type) ? 'm4a' : /ogg/.test(type) ? 'ogg' : 'webm';
  const path = `${clinic}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
  const up = await s.from(VOICE_BUCKET).upload(path, audio, { contentType: type || 'audio/mp4', upsert: false });
  if (up.error) throw new Error(up.error.message);
  const { data, error } = await db().from('staff_messages')
    .insert({ clinic_id: clinic, body: '🎤 رسالة صوتية', from_label: from.slice(0, 60), audio_path: path, audio_type: type || 'audio/mp4' }).select().single();
  if (error) throw new Error(/audio_path/.test(error.message) ? 'Run supabase/migrations/014_staff_voice.sql first' : error.message);
  await rpc('refresh_display', { p_clinic: clinic, p_date: await sessionDate(clinic) }).catch(() => {});
  return data;
}

export async function staffVoiceFile(clinic: string, id: number): Promise<{ buf: Buffer; type: string } | null> {
  const { data: m } = await db().from('staff_messages').select('audio_path, audio_type').eq('clinic_id', clinic).eq('id', id).maybeSingle();
  if (!m?.audio_path) return null;
  const { data } = await db().storage.from(VOICE_BUCKET).download(m.audio_path);
  return data ? { buf: Buffer.from(await data.arrayBuffer()), type: m.audio_type || 'audio/mp4' } : null;
}
