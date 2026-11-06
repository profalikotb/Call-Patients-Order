import { COOKIE } from '@/lib/server/auth';
import { json } from '@/lib/server/http';
export const POST = async () => { const r = json({ ok: true }); r.cookies.delete(COOKIE); return r; };
