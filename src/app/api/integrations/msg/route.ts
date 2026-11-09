// MS Access → assistant message:  POST {clinic:"auto", text:"أدخل المريض التالي", actor}  (header X-Queue-Token)
import { handle, json, HttpError, clinicParam } from '@/lib/server/http';
import { clean } from '@/lib/envClean';
import { getSession, defaultClinic } from '@/lib/server/session';
import { sendStaffMsg } from '@/lib/server/staffMsg';
export const runtime = 'nodejs';

export const POST = handle(async (req) => {
  const want = clean(process.env.QUEUE_API_TOKEN);
  if (!want || clean(req.headers.get('x-queue-token')) !== want) throw new HttpError(401, 'bad_token');
  const b = await req.json().catch(() => null);
  if (!b?.text) throw new HttpError(400, 'empty');
  const s = await getSession(defaultClinic());
  const clinic = clinicParam(!b.clinic || b.clinic === 'auto' ? (s?.clinic ?? defaultClinic()) : String(b.clinic));
  try { await sendStaffMsg(clinic, String(b.text), String(b.actor || 'الطبيب').replace(/^Access@/, 'الطبيب – ')); }
  catch (e: any) { throw new HttpError(400, String(e?.message || e)); }
  return json({ ok: true, clinic });
});
