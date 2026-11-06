// Pre-synthesise & cache announcements for numbers [from..to] (≤ 15 per call; UI loops in chunks).
import { handle, json, requireStaff, clinicParam } from '@/lib/server/http';
import { getClinicSettings } from '@/lib/server/settings';
import { speak } from '@/lib/server/tts';
import { renderAnnouncement } from '@/lib/announce';
export const runtime = 'nodejs';
export const maxDuration = 60;

export const POST = handle(async (req) => {
  await requireStaff({ admin: true });
  const b = await req.json().catch(() => ({}));
  const clinic = clinicParam(b.clinic);
  const s = await getClinicSettings(clinic);
  const from = Math.max(1, +b.from || 1), to = Math.min(from + 14, +b.to || from);
  const out: any[] = [];
  for (let n = from; n <= to; n++) {
    for (const v of ['call', 'repeat'] as const) {
      try { const r = await speak(renderAnnouncement(s, n, v), s.voice, true); out.push({ n, v, cached: r.cached, provider: r.provider }); }
      catch (e: any) { out.push({ n, v, error: String(e?.message || e) }); }
    }
  }
  return json({ ok: out.every((x) => !x.error), results: out });
});
