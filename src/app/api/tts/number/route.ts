// Number-only announcement audio (privacy default). Cacheable – identical for every patient with that number.
import { handle, checkDisplayKey, clinicParam, HttpError, json } from '@/lib/server/http';
import { getClinicSettings } from '@/lib/server/settings';
import { speak, audioResponse } from '@/lib/server/tts';
import { renderAnnouncement } from '@/lib/announce';
import type { Variant } from '@/lib/config';
export const runtime = 'nodejs';

export const GET = handle(async (req) => {
  const u = new URL(req.url);
  checkDisplayKey(u.searchParams.get('k'));
  const clinic = clinicParam(u.searchParams.get('clinic'));
  const n = Number(u.searchParams.get('n'));
  const variant = (u.searchParams.get('variant') || 'call') as Variant;
  if (!Number.isInteger(n) || n < 1 || n > 9999) throw new HttpError(400, 'bad_number');
  if (!['call', 'repeat', 'recall'].includes(variant)) throw new HttpError(400, 'bad_variant');
  const s = await getClinicSettings(clinic);
  try {
    return audioResponse(await speak(renderAnnouncement(s, n, variant), s.voice, true), 86400);
  } catch (e: any) {
    return json({ ok: false, error: 'tts_unavailable', detail: String(e?.message || e) }, 503);
  }
});
