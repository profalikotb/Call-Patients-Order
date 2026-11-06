// Configuration check – shows only WHICH settings are present (never their values).
import { json } from '@/lib/server/http';
import { db } from '@/lib/server/db';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  const e = process.env;
  const env = {
    NEXT_PUBLIC_SUPABASE_URL: !!e.NEXT_PUBLIC_SUPABASE_URL,
    NEXT_PUBLIC_SUPABASE_ANON_KEY: !!e.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    SUPABASE_SERVICE_ROLE_KEY: !!e.SUPABASE_SERVICE_ROLE_KEY,
    SESSION_SECRET: (e.SESSION_SECRET || '').length >= 32 ? 'ok' : (e.SESSION_SECRET ? `too short (${e.SESSION_SECRET.length} < 32)` : false),
    ADMIN_USERNAME: e.ADMIN_USERNAME ? `set (${e.ADMIN_USERNAME.trim().length} chars${e.ADMIN_USERNAME !== e.ADMIN_USERNAME.trim() ? ', HAS SPACES' : ''})` : false,
    ADMIN_PASSWORD: e.ADMIN_PASSWORD ? `set (${e.ADMIN_PASSWORD.length} chars${e.ADMIN_PASSWORD !== e.ADMIN_PASSWORD.trim() ? ', HAS SPACES' : ''})` : false,
    DISPLAY_KEY: !!e.DISPLAY_KEY,
    SHEET_SOURCE: e.SHEET_SOURCE || '(default google)',
    APPS_SCRIPT_FEED_URL: !!e.APPS_SCRIPT_FEED_URL,
    APPS_SCRIPT_FEED_TOKEN: !!e.APPS_SCRIPT_FEED_TOKEN,
    AZURE_SPEECH_KEY: !!e.AZURE_SPEECH_KEY,
    DEMO_MODE: e.DEMO_MODE || '0',
    VERCEL_ENV: e.VERCEL_ENV || 'local',
  };
  // The project URL is public (NEXT_PUBLIC_*) – shown so a wrong / old project is obvious.
  const rawUrl = e.NEXT_PUBLIC_SUPABASE_URL || '';
  let urlCheck = 'missing';
  if (rawUrl) {
    const problems: string[] = [];
    if (rawUrl !== rawUrl.trim()) problems.push('has spaces');
    if (/^["']|["']$/.test(rawUrl.trim())) problems.push('has quotes');
    if (!/^https:\/\//.test(rawUrl.trim())) problems.push('must start with https://');
    if (/\/rest\/v1|\/$/.test(rawUrl.trim())) problems.push('remove /rest/v1 or trailing /');
    if (/supabase\.com\/dashboard/.test(rawUrl)) problems.push('this is the DASHBOARD address, use Project URL https://<ref>.supabase.co');
    if (!/^https:\/\/[a-z0-9]{20}\.supabase\.co$/.test(rawUrl.trim())) problems.push('expected format https://<20-letter-ref>.supabase.co');
    urlCheck = problems.length ? 'WRONG: ' + problems.join('; ') : 'format ok';
  }
  let supabase: string;
  try {
    const { error } = await db().from('clinics').select('id').limit(1);
    supabase = error ? `ERROR: ${error.message}` : 'ok (tables found)';
  } catch (err: any) {
    const cause = err?.cause?.code || err?.cause?.message || '';
    supabase = `ERROR: ${err?.message || err}${cause ? ' [' + cause + ']' : ''}` +
      (cause === 'ENOTFOUND' ? ' → this project address does not exist (wrong/deleted project)' : '');
  }
  return json({ ok: true, supabase_url: rawUrl, supabase_url_check: urlCheck, env, supabase });
}
