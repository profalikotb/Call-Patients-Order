// Clinic session (migration 009): GET current (+ recent sessions), POST start / end.
import { handle, json, requireStaff, HttpError, clinicParam } from '@/lib/server/http';
import { rpc } from '@/lib/server/db';
import { getSession } from '@/lib/server/session';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const need009 = (e: any) => {
  const m = String(e?.message || e);
  throw new HttpError(500, /session_/.test(m) ? 'Run supabase/migrations/009_sessions.sql in Supabase first' : m);
};

export const GET = handle(async (req) => {
  await requireStaff();
  const withList = new URL(req.url).searchParams.get('list') === '1';
  const session = await getSession();
  const list = withList ? await rpc<any[]>('session_list', { p_limit: 30 }).catch(need009) : undefined;
  return json({ ok: true, session, sessions: list });
});

export const POST = handle(async (req) => {
  const st = await requireStaff();
  const b = await req.json().catch(() => null);
  if (!b) throw new HttpError(400, 'bad_json');
  const by = st.name || st.sub || 'staff';
  if (b.action === 'start') {
    const clinic = clinicParam(String(b.clinic || ''));
    const date = b.date && /^\d{4}-\d{2}-\d{2}$/.test(String(b.date)) ? String(b.date) : null;
    const s = await rpc<any>('session_start', { p_clinic: clinic, p_date: date, p_by: by }).catch(need009);
    return json({ ok: true, session: s });
  }
  if (b.action === 'end') {
    const s = await rpc<any>('session_end', { p_by: by }).catch(need009);
    return json({ ok: true, ended: s });
  }
  throw new HttpError(400, 'bad_action');
});
