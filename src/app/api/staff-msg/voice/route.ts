// POST ?clinic=  body = recorded audio (audio/mp4 from iPhone, audio/webm from PC)  → voice note to the assistant
// GET  ?clinic=&id=  → the audio file (staff only)
import { handle, json, requireStaff, clinicParam, HttpError } from '@/lib/server/http';
import { sendStaffVoice, staffVoiceFile } from '@/lib/server/staffMsg';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const POST = handle(async (req) => {
  const clinic = clinicParam(new URL(req.url).searchParams.get('clinic'));
  const me = await requireStaff({ clinic });
  const buf = Buffer.from(await req.arrayBuffer());
  try { return json({ ok: true, message: await sendStaffVoice(clinic, buf, req.headers.get('content-type') || 'audio/mp4', me.name || me.sub) }); }
  catch (e: any) { throw new HttpError(400, String(e?.message || e)); }
});

export const GET = handle(async (req) => {
  const u = new URL(req.url);
  const clinic = clinicParam(u.searchParams.get('clinic'));
  await requireStaff({ clinic });
  const f = await staffVoiceFile(clinic, Number(u.searchParams.get('id')));
  if (!f) throw new HttpError(404, 'not_found');
  return new Response(new Uint8Array(f.buf), { headers: { 'Content-Type': f.type, 'Cache-Control': 'private, max-age=3600' } });
});
