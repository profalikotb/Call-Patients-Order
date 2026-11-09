import { handle, json, checkDisplayKey, clinicParam } from '@/lib/server/http';
import { db } from '@/lib/server/db';
import { sessionDate } from '@/lib/server/session';
export const runtime = 'nodejs';

export const POST = handle(async (req) => {
  const b = await req.json().catch(() => ({}));
  checkDisplayKey(b.k);
  const clinic = clinicParam(b.clinic);
  await db().from('announcements').update({ played_at: new Date().toISOString(), played_device: String(b.deviceId || '').slice(0, 64) })
    .eq('clinic_id', clinic).eq('service_date', await sessionDate(clinic)).eq('seq', Number(b.seq)).is('played_at', null);
  return json({ ok: true });
});
