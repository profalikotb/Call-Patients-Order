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
  let supabase: string;
  try {
    const { error } = await db().from('clinics').select('id').limit(1);
    supabase = error ? `ERROR: ${error.message}` : 'ok (tables found)';
  } catch (err: any) {
    supabase = `ERROR: ${err?.message || err}`;
  }
  return json({ ok: true, env, supabase });
}
