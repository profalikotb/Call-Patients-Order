// Configuration check – shows WHICH settings are present and whether each Supabase key is accepted.
// Never prints secret values (only type, length and first characters).
import { json } from '@/lib/server/http';
import { db } from '@/lib/server/db';
import { clean, cleanUrl } from '@/lib/envClean';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function describeKey(raw: string | undefined, urlRef: string) {
  if (!raw) return { present: false };
  const k = clean(raw);
  const info: Record<string, unknown> = {
    present: true,
    length: k.length,
    starts_with: k.slice(0, 15) + '…',
    had_spaces_or_quotes: k !== raw,
  };
  if (k.startsWith('sb_publishable_')) info.type = 'new publishable key';
  else if (k.startsWith('sb_secret_')) info.type = 'new secret key';
  else if (k.split('.').length === 3) {
    try {
      const p = JSON.parse(Buffer.from(k.split('.')[1], 'base64url').toString('utf8'));
      info.type = `legacy JWT (role: ${p.role})`;
      info.project_ref = p.ref;
      info.matches_url = urlRef ? p.ref === urlRef : 'unknown';
    } catch { info.type = 'BROKEN JWT (incomplete copy?)'; }
  } else info.type = 'UNKNOWN format (wrong value?)';
  return info;
}

async function probe(url: string, key: string) {
  if (!url || !key) return 'skipped';
  try {
    const r = await fetch(`${url}/rest/v1/clinics?select=id&limit=1`, {
      headers: { apikey: key, ...(key.startsWith('sb_') ? {} : { Authorization: `Bearer ${key}` }) },
      cache: 'no-store',
    });
    const body = await r.text();
    if (r.ok) return `ok (HTTP ${r.status})`;
    let msg = body.slice(0, 160);
    try { const j = JSON.parse(body); msg = j.message || j.msg || j.error || msg; } catch {}
    return `REJECTED (HTTP ${r.status}): ${msg}`;
  } catch (e: any) {
    return `NETWORK ERROR: ${e?.message}${e?.cause?.code ? ' [' + e.cause.code + ']' : ''}`;
  }
}

export async function GET(req: Request) {
  const e = process.env;
  const url = cleanUrl(e.NEXT_PUBLIC_SUPABASE_URL);
  const urlRef = (url.match(/^https:\/\/([a-z0-9]+)\.supabase\.co$/) || [])[1] || '';
  const service = clean(e.SUPABASE_SERVICE_ROLE_KEY || e.SUPABASE_SECRET_KEY);
  const anon = clean(e.NEXT_PUBLIC_SUPABASE_ANON_KEY);

  const report: Record<string, unknown> = {
    supabase_url: url || '(missing)',
    supabase_url_ok: urlRef ? 'format ok' : 'WRONG – must be https://<project-ref>.supabase.co',
    service_role_key: describeKey(e.SUPABASE_SERVICE_ROLE_KEY || e.SUPABASE_SECRET_KEY, urlRef),
    anon_key: describeKey(e.NEXT_PUBLIC_SUPABASE_ANON_KEY, urlRef),
    service_key_test: await probe(url, service),
    anon_key_test: await probe(url, anon),
  };
  if (service && service === anon) report.WARNING = 'service role key and anon key are the SAME value – the service key must be the SECRET key';
  if (service.startsWith('sb_publishable_')) report.WARNING = 'SUPABASE_SERVICE_ROLE_KEY contains the PUBLISHABLE key – use the sb_secret_… key';

  try {
    const { error } = await db().from('clinics').select('id').limit(1);
    report.supabase = error ? `ERROR: ${error.message}` : 'ok (tables found)';
  } catch (err: any) {
    report.supabase = `ERROR: ${err?.message || err}`;
  }

  // Google Sheet feed (Apps Script web app) – the same request the queue makes
  if ((e.SHEET_SOURCE || '') === 'push') {
    const { data: days } = await db().from('queue_days').select('clinic_id, last_sync_ok_at, last_sync_error')
      .eq('service_date', new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Cairo' }).format(new Date()));
    report.push_from_desktop = (days ?? []).length
      ? (days ?? []).map((d: any) => `${d.clinic_id}: last push ${d.last_sync_ok_at ?? 'never'}${d.last_sync_error ? ' – ERROR ' + d.last_sync_error : ''}`).join(' | ')
      : 'no push received today yet';
  }
  if ((e.SHEET_SOURCE || '') === 'appsscript') {
    try {
      const u = new URL(clean(e.APPS_SCRIPT_FEED_URL));
      if (!/\/exec$/.test(u.pathname)) report.feed_url_warning = 'URL must end with /exec (Deploy → Manage deployments → Web app URL)';
      u.searchParams.set('token', clean(e.APPS_SCRIPT_FEED_TOKEN));
      u.searchParams.set('tab', 'QUEUE_TODAY');
      const r = await fetch(u.toString(), { redirect: 'follow', cache: 'no-store' });
      const text = await r.text();
      let j: any = null; try { j = JSON.parse(text); } catch {}
      if (!r.ok) report.sheet_feed = `REJECTED (HTTP ${r.status}) – web app not deployed for "Anyone", or wrong URL`;
      else if (!j) report.sheet_feed = 'NOT JSON – Google returned a login/HTML page: set Web app access to "Anyone"';
      else if (!j.ok) report.sheet_feed = `ERROR from Apps Script: ${j.error}` +
        (j.error === 'forbidden' ? ' → APPS_SCRIPT_FEED_TOKEN ≠ FEED_TOKEN (run setupFeed() and copy the token)' :
         j.error === 'unauthorized' ? ' → the deployed web app is the OLD push version: Deploy → Manage deployments → Edit → New version' :
         j.error === 'tab_not_found' ? ' → tab QUEUE_TODAY missing: Oracle → Refresh now in the sheet' : '');
      else if (!Array.isArray(j.values)) report.sheet_feed = 'OLD web app version (no "values") → Deploy → Manage deployments → Edit → Version: New version → Deploy';
      else report.sheet_feed = `ok – ${Math.max(0, j.values.length - 1)} rows; headers: ${(j.values[0] || []).join(' | ')}`;
    } catch (err: any) {
      report.sheet_feed = `ERROR: ${err?.message || err}`;
    }
  }

  report.env = {
    SESSION_SECRET: (e.SESSION_SECRET || '').length >= 32 ? 'ok' : (e.SESSION_SECRET ? 'too short' : false),
    ADMIN_USERNAME: !!e.ADMIN_USERNAME, ADMIN_PASSWORD: !!e.ADMIN_PASSWORD, DISPLAY_KEY: !!e.DISPLAY_KEY,
    SHEET_SOURCE: e.SHEET_SOURCE || '(default google)',
    APPS_SCRIPT_FEED_URL: !!e.APPS_SCRIPT_FEED_URL, APPS_SCRIPT_FEED_TOKEN: !!e.APPS_SCRIPT_FEED_TOKEN,
    AZURE_SPEECH_KEY: !!e.AZURE_SPEECH_KEY, QUEUE_API_TOKEN: clean(e.QUEUE_API_TOKEN).length >= 16 ? 'ok' : (e.QUEUE_API_TOKEN ? 'too short' : false), DEMO_MODE: e.DEMO_MODE || '0', VERCEL_ENV: e.VERCEL_ENV || 'local',
    DEPLOYED_COMMIT: (e.VERCEL_GIT_COMMIT_SHA || '').slice(0, 7) || 'unknown',
  };
  // voice check: /api/health?tts=1 → speaks a short test with the configured voice (heliopolis settings)
  try {
    const u = new URL(req.url);
    if (u.searchParams.get('tts') === '1') {
      const { getClinicSettings } = await import('@/lib/server/settings');
      const { speak, providersAvailable } = await import('@/lib/server/tts');
      const s = await getClinicSettings('heliopolis');
      const t: Record<string, unknown> = { providers: providersAvailable(), provider_setting: s.voice.provider,
        voice: s.voice.provider === 'elevenlabs' ? (s.voice.elevenVoiceId || process.env.ELEVENLABS_VOICE_ID) : s.voice.azureVoice };
      try { const r = await speak('رقم واحد', s.voice, false); t.result = `ok – ${r.provider}, ${r.audio.length} bytes`; }
      catch (e: any) { t.result = 'FAILED: ' + String(e?.message || e); }
      (report as any).tts_test = t;
    }
  } catch (e: any) { (report as any).tts_test = 'error: ' + String(e?.message || e); }
  // online bookings feed (patient code → WhatsApp phone)
  if (e.BOOKINGS_FEED_URL) {
    try {
      const { bookingsByCode } = await import('@/lib/server/bookings');
      const { cairoDate } = await import('@/lib/time');
      (report as any).bookings_feed = `ok – ${(await bookingsByCode(cairoDate())).size} coded bookings today`;
    } catch (x: any) { (report as any).bookings_feed = 'error: ' + String(x?.message || x); }
  } else (report as any).bookings_feed = 'not set (BOOKINGS_FEED_URL)';
  return json(report);
}
