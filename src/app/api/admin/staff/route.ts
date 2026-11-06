import { handle, json, requireStaff, HttpError } from '@/lib/server/http';
import { db } from '@/lib/server/db';
import { hashPassword } from '@/lib/server/auth';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const GET = handle(async () => {
  await requireStaff({ admin: true });
  const { data, error } = await db().from('staff').select('id,username,display_name,role,clinics,active,created_at').order('created_at');
  if (error) throw error;
  return json({ ok: true, staff: data });
});

export const POST = handle(async (req) => {
  await requireStaff({ admin: true });
  const b = await req.json().catch(() => ({}));
  const username = String(b.username || '').trim().toLowerCase();
  if (!/^[a-z0-9._-]{3,32}$/.test(username)) throw new HttpError(400, 'bad_username');
  if (!['admin', 'reception'].includes(b.role)) throw new HttpError(400, 'bad_role');
  const row: any = { username, display_name: String(b.display_name || username).slice(0, 60), role: b.role,
    clinics: Array.isArray(b.clinics) && b.clinics.length ? b.clinics : null, active: b.active !== false };
  if (b.password) {
    if (String(b.password).length < 6) throw new HttpError(400, 'weak_password');
    row.password_hash = hashPassword(String(b.password));
  }
  const exists = await db().from('staff').select('id').eq('username', username).maybeSingle();
  if (!exists.data && !row.password_hash) throw new HttpError(400, 'password_required');
  const { error } = exists.data ? await db().from('staff').update(row).eq('username', username) : await db().from('staff').insert(row);
  if (error) throw error;
  return json({ ok: true });
});

export const DELETE = handle(async (req) => {
  await requireStaff({ admin: true });
  const username = new URL(req.url).searchParams.get('username');
  const { error } = await db().from('staff').delete().eq('username', username);
  if (error) throw error;
  return json({ ok: true });
});
