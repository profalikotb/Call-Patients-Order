import { NextResponse, type NextRequest } from 'next/server';
import { jwtVerify } from 'jose';

// Page-level gate. APIs enforce auth/roles themselves (requireStaff / display key).
export async function middleware(req: NextRequest) {
  const token = req.cookies.get('pq_session')?.value;
  let ok = false;
  if (token && process.env.SESSION_SECRET) {
    try { await jwtVerify(token, new TextEncoder().encode(process.env.SESSION_SECRET)); ok = true; } catch {}
  }
  if (!ok) {
    const u = req.nextUrl.clone();
    u.pathname = '/login';
    u.search = `?next=${encodeURIComponent(req.nextUrl.pathname)}`;
    return NextResponse.redirect(u);
  }
  return NextResponse.next();
}
export const config = { matcher: ['/', '/reception/:path*', '/admin/:path*', '/summary/:path*'] };
