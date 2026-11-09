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
