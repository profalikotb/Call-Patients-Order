import { getSession } from '@/lib/server/auth';
import { json } from '@/lib/server/http';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const GET = async () => { const s = await getSession(); return json({ ok: !!s, session: s }, s ? 200 : 401); };
