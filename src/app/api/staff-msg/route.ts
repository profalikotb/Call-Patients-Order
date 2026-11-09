// Staff messages: GET ?clinic=  ·  POST {clinic, text} = send  ·  POST {clinic, ack: id} = mark read
import { handle, json, requireStaff, clinicParam, HttpError } from '@/lib/server/http';
import { sendStaffMsg, listStaffMsgs, ackStaffMsg } from '@/lib/server/staffMsg';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const GET = handle(async (req) => {
  const clinic = clinicParam(new URL(req.url).searchParams.get('clinic'));
  await requireStaff({ clinic });
  return json({ ok: true, messages: await listStaffMsgs(clinic) });
});

export const POST = handle(async (req) => {
  const b = await req.json().catch(() => null);
  if (!b) throw new HttpError(400, 'bad_json');
  const clinic = clinicParam(String(b.clinic || ''));
  const me = await requireStaff({ clinic });
  if (b.ack) { await ackStaffMsg(clinic, Number(b.ack), me.name || me.sub); return json({ ok: true }); }
  try { return json({ ok: true, message: await sendStaffMsg(clinic, String(b.text || ''), me.name || me.sub) }); }
  catch (e: any) { throw new HttpError(400, String(e?.message || e)); }
});
