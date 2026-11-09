// Online bookings (AllEvents2025 via a read-only Apps Script feed) → WhatsApp phone + booked time per PATIENT CODE.
// Oracle stays the master list: this only ADDS information to patients whose code matches exactly.
import { clean, cleanUrl } from '@/lib/envClean';

export interface Booking { phone: string; time: string; procedure: string; name: string }
const cache = new Map<string, { at: number; map: Map<string, Booking> }>();

export async function bookingsByCode(date: string): Promise<Map<string, Booking>> {
  const url = cleanUrl(process.env.BOOKINGS_FEED_URL), token = clean(process.env.BOOKINGS_FEED_TOKEN);
  if (!url || !token) return new Map();
  const hit = cache.get(date);
  if (hit && Date.now() - hit.at < 60_000) return hit.map;           // at most one read per minute
  try {
    const u = `${url}${url.includes('?') ? '&' : '?'}token=${encodeURIComponent(token)}&date=${date}`;
    const r = await fetch(u, { redirect: 'follow', signal: AbortSignal.timeout(8000), cache: 'no-store' });
    const j: any = await r.json();
    const map = new Map<string, Booking>();
    if (j?.ok) for (const x of j.rows ?? []) if (x?.code) map.set(String(x.code), {
      phone: String(x.phone || ''), time: String(x.time || ''), procedure: String(x.procedure || ''), name: String(x.name || '') });
    cache.set(date, { at: Date.now(), map });
    return map;
  } catch {
    return hit?.map ?? new Map();                                    // feed down → keep last good data, never block the queue
  }
}
