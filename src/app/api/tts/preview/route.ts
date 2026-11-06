// Staff preview: hear any number/variant or a custom phrase with the current (or draft) voice settings.
import { handle, requireStaff, clinicParam, json } from '@/lib/server/http';
import { getClinicSettings } from '@/lib/server/settings';
import { speak, audioResponse, providersAvailable } from '@/lib/server/tts';
import { renderAnnouncement } from '@/lib/announce';
import { mergeSettings, type Variant } from '@/lib/config';
export const runtime = 'nodejs';

export const POST = handle(async (req) => {
  const b = await req.json().catch(() => ({}));
  const clinic = clinicParam(b.clinic);
  await requireStaff({ clinic });
  const base = await getClinicSettings(clinic);
  const s = b.draft ? mergeSettings({ ...base, ...b.draft, voice: { ...base.voice, ...(b.draft.voice ?? {}) } }, clinic) : base;
  const text = b.text ? String(b.text).slice(0, 300) : renderAnnouncement(s, Math.max(1, Math.min(9999, Number(b.n) || 1)), (b.variant || 'call') as Variant);
  if (!providersAvailable().azure && !providersAvailable().elevenlabs) return json({ ok: false, error: 'no_tts_provider', text }, 503);
  try { return audioResponse(await speak(text, s.voice, !b.text), 0); }
  catch (e: any) { return json({ ok: false, error: 'tts_unavailable', detail: String(e?.message || e), text }, 503); }
});
