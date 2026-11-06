import { authenticate, signSession, COOKIE } from '@/lib/server/auth';
import { handle, json } from '@/lib/server/http';
export const runtime = 'nodejs';

export const POST = handle(async (req) => {
  const { username, password } = await req.json().catch(() => ({}));
  const s = username && password ? await authenticate(String(username), String(password)) : null;
  if (!s) { await new Promise((r) => setTimeout(r, 700)); return json({ ok: false, error: 'invalid_credentials' }, 401); }
  const res = json({ ok: true, session: s });
  res.cookies.set(COOKIE, await signSession(s), { httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'lax', path: '/', maxAge: 14 * 3600 });
  return res;
});
