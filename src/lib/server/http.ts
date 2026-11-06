import { clean } from '../envClean';
import { NextResponse } from 'next/server';
import { timingSafeEqual } from 'node:crypto';
import { getSession, canAccessClinic, type Session } from './auth';

export const json = (data: unknown, status = 200) =>
  NextResponse.json(data, { status, headers: { 'Cache-Control': 'no-store' } });

export class HttpError extends Error { constructor(public status: number, msg: string) { super(msg); } }

export async function requireStaff(opts: { clinic?: string | null; admin?: boolean } = {}): Promise<Session> {
  const s = await getSession();
  if (!s) throw new HttpError(401, 'unauthorized');
  if (opts.admin && s.role !== 'admin') throw new HttpError(403, 'forbidden');
  if (opts.clinic && !canAccessClinic(s, opts.clinic)) throw new HttpError(403, 'forbidden_clinic');
  return s;
}

/** Waiting-room screens authenticate with a display key in the URL (?k=…). */
export function checkDisplayKey(k: string | null) {
  const want = clean(process.env.DISPLAY_KEY);
  if (!want) throw new HttpError(500, 'DISPLAY_KEY not configured');
  const a = Buffer.from(clean(k)), b = Buffer.from(want);
  if (a.length !== b.length || !timingSafeEqual(a, b)) throw new HttpError(403, 'bad_display_key');
}

export function handle(fn: (req: Request) => Promise<Response>) {
  return async (req: Request) => {
    try { return await fn(req); }
    catch (e: any) {
      if (e instanceof HttpError) return json({ ok: false, error: e.message }, e.status);
      console.error(e);
      return json({ ok: false, error: 'server_error', detail: String(e?.message || e) }, 500);
    }
  };
}

export const CLINIC_RE = /^[a-z0-9-]{2,40}$/;
export function clinicParam(v: string | null): string {
  if (!v || !CLINIC_RE.test(v)) throw new HttpError(400, 'bad_clinic');
  return v;
}
