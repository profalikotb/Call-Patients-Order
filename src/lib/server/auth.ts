import { SignJWT, jwtVerify } from 'jose';
import { scryptSync, randomBytes, timingSafeEqual } from 'node:crypto';
import { cookies } from 'next/headers';
import { db } from './db';

export const COOKIE = 'pq_session';
export interface Session { sub: string; name: string; role: 'admin' | 'reception'; clinics: string[] | null }

function secret() {
  const s = process.env.SESSION_SECRET;
  if (!s || s.length < 32) throw new Error('SESSION_SECRET must be set (≥32 chars)');
  return new TextEncoder().encode(s);
}

export function hashPassword(pw: string): string {
  const salt = randomBytes(16);
  const h = scryptSync(pw, salt, 32, { N: 16384, r: 8, p: 1 });
  return `scrypt$${salt.toString('base64')}$${h.toString('base64')}`;
}

export function verifyPassword(pw: string, stored: string): boolean {
  const [alg, s, h] = stored.split('$');
  if (alg !== 'scrypt' || !s || !h) return false;
  const want = Buffer.from(h, 'base64');
  const got = scryptSync(pw, Buffer.from(s, 'base64'), want.length, { N: 16384, r: 8, p: 1 });
  return timingSafeEqual(want, got);
}

function safeEq(a: string, b: string) {
  const x = Buffer.from(a), y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

export async function authenticate(username: string, password: string): Promise<Session | null> {
  const u = username.trim().toLowerCase();
  // bootstrap admin from env (always works – use it to create staff, then keep it secret)
  const envU = (process.env.ADMIN_USERNAME || '').toLowerCase();
  const envP = process.env.ADMIN_PASSWORD || '';
  if (envU && envP && safeEq(u, envU) && safeEq(password, envP)) {
    return { sub: `env:${u}`, name: process.env.ADMIN_DISPLAY_NAME || 'Admin', role: 'admin', clinics: null };
  }
  const { data } = await db().from('staff').select('*').eq('username', u).eq('active', true).maybeSingle();
  if (!data || !verifyPassword(password, data.password_hash)) return null;
  return { sub: data.username, name: data.display_name, role: data.role, clinics: data.clinics };
}

export async function signSession(s: Session): Promise<string> {
  return new SignJWT({ ...s }).setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('14h').sign(secret());
}

export async function readSession(token: string | undefined): Promise<Session | null> {
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, secret());
    return { sub: String(payload.sub), name: String(payload.name), role: payload.role as Session['role'], clinics: (payload.clinics as string[] | null) ?? null };
  } catch { return null; }
}

export async function getSession(): Promise<Session | null> {
  const jar = await cookies();
  return readSession(jar.get(COOKIE)?.value);
}

export function canAccessClinic(s: Session, clinic: string) {
  return s.role === 'admin' || !s.clinics || s.clinics.includes(clinic);
}
