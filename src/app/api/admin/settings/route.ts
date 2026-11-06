import { clean } from '@/lib/envClean';
import { handle, json, requireStaff, clinicParam, HttpError } from '@/lib/server/http';
import { db } from '@/lib/server/db';
import { getClinics, getClinicSettings, getSheetConfig, bust } from '@/lib/server/settings';
import { providersAvailable } from '@/lib/server/tts';
import { sheetSource } from '@/lib/server/sheets';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const GET = handle(async (req) => {
  await requireStaff({ admin: true });
  const clinic = clinicParam(new URL(req.url).searchParams.get('clinic'));
  bust();
  const [clinics, settings, sheet] = await Promise.all([getClinics(), getClinicSettings(clinic), getSheetConfig()]);
  return json({ ok: true, clinics, settings, sheet, tts: providersAvailable(), sheet_source: sheetSource(), display_key: clean(process.env.DISPLAY_KEY) });
});

const clamp = (v: any, lo: number, hi: number, d: number) => (Number.isFinite(+v) ? Math.min(hi, Math.max(lo, +v)) : d);

export const PUT = handle(async (req) => {
  await requireStaff({ admin: true });
  const b = await req.json().catch(() => null);
  if (!b) throw new HttpError(400, 'bad_json');
  if (b.settings) {
    const clinic = clinicParam(b.settings.clinic_id);
    const s = b.settings, v = s.voice ?? {};
    if (!['time', 'checkin', 'manual'].includes(s.policy)) throw new HttpError(400, 'bad_policy');
    const voice = { ...v, rate: clamp(v.rate, -40, 30, -8), pitch: clamp(v.pitch, -20, 20, 0), volume: clamp(v.volume, 0, 1.5, 1),
      repeatCount: clamp(v.repeatCount, 1, 3, 2), repeatDelaySec: clamp(v.repeatDelaySec, 1, 15, 4) };
    const { error } = await db().from('clinic_settings').upsert({
      clinic_id: clinic, policy: s.policy, room_label: String(s.room_label || 'غرفة الكشف').slice(0, 60),
      default_consult_minutes: clamp(s.default_consult_minutes, 2, 60, 10),
      voice, templates: s.templates ?? {}, display: s.display ?? {}, updated_at: new Date().toISOString(),
    });
    if (error) throw error;
    await db().rpc('refresh_display', { p_clinic: clinic, p_date: new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Cairo' }).format(new Date()) });
  }
  if (b.sheet) {
    const { error } = await db().from('app_config').upsert({ key: 'sheet', value: b.sheet, updated_at: new Date().toISOString() });
    if (error) throw error;
  }
  if (Array.isArray(b.clinics)) {
    for (const c of b.clinics) {
      clinicParam(c.id);
      const { error } = await db().from('clinics').upsert({ id: c.id, name_ar: c.name_ar, name_en: c.name_en,
        sheet_aliases: (c.sheet_aliases ?? []).map(String).filter(Boolean), active: c.active !== false, sort: +c.sort || 0 });
      if (error) throw error;
      await db().from('clinic_settings').upsert({ clinic_id: c.id }, { onConflict: 'clinic_id', ignoreDuplicates: true });
    }
  }
  bust();
  return json({ ok: true });
});
