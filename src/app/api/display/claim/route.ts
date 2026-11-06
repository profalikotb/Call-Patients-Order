import { handle, json, checkDisplayKey, clinicParam, HttpError } from '@/lib/server/http';
import { rpc } from '@/lib/server/db';
export const runtime = 'nodejs';

// The single-speaker lease: only the holder plays audio. Heartbeat every 20 s, lease 60 s.
export const POST = handle(async (req) => {
  const b = await req.json().catch(() => ({}));
  checkDisplayKey(b.k);
  const clinic = clinicParam(b.clinic);
  if (typeof b.deviceId !== 'string' || !/^[a-zA-Z0-9-]{8,64}$/.test(b.deviceId)) throw new HttpError(400, 'bad_device');
  if (b.release) { await rpc('display_release', { p_clinic: clinic, p_device: b.deviceId }); return json({ ok: true }); }
  const r = await rpc('display_claim', { p_clinic: clinic, p_device: b.deviceId,
    p_label: String(b.label || 'شاشة الانتظار').slice(0, 60), p_force: !!b.force, p_lease_seconds: 60 });
  return json(r);
});
