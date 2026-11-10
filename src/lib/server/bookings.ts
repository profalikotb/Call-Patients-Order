// Online bookings (AllEvents2025 via a read-only Apps Script feed).
//  • bookingsList  – the whole day's list (read-only guide panel in reception)
//  • bookingsByCode – exact PATIENT CODE → WhatsApp phone + booked time (Oracle stays the master list)
import { clean, cleanUrl } from '@/lib/envClean';

export interface Booking { serial: number; code: string; phone: string; time: string; procedure: string; name: string }
const cache = new Map<string, { at: number; list: Booking[] }>();

export async function bookingsList(date: string): Promise<Booking[]> {
  const url = cleanUrl(process.env.BOOKINGS_FEED_URL), token = clean(process.env.BOOKINGS_FEED_TOKEN);
  if (!url || !token) return [];
  const hit = cache.get(date);
  if (hit && Date.now() - hit.at < 60_000) return hit.list;            // at most one read per minute
  try {
    const u = `${url}${url.includes('?') ? '&' : '?'}token=${encodeURIComponent(token)}&date=${date}`;
    const r = await fetch(u, { redirect: 'follow', signal: AbortSignal.timeout(8000), cache: 'no-store' });
    const j: any = await r.json();
    if (!j?.ok) return hit?.list ?? [];
    const list: Booking[] = (j.rows ?? []).map((x: any) => ({
      serial: 0, code: String(x.code ?? '').trim(), phone: String(x.phone || ''), time: String(x.time || ''),
      procedure: String(x.procedure || ''), name: String(x.name || '') }));
    list.sort((a, b) => minutes(a.time) - minutes(b.time));
    list.forEach((b, i) => { b.serial = i + 1; });                     // «#» as on the booking page
    cache.set(date, { at: Date.now(), list });
    return list;
  } catch {
    return hit?.list ?? [];                                             // feed down → keep last good data, never block the queue
  }
}

export async function bookingsByCode(date: string): Promise<Map<string, Booking>> {
  const m = new Map<string, Booking>();
  for (const b of await bookingsList(date)) if (/^\d+$/.test(b.code)) m.set(b.code, b);
  return m;
}

// "7:30:00 pm" / "PM 07:30" / "19:30" → minutes after midnight (unknown → end)
function minutes(t: string): number {
  const m = t.match(/(\d{1,2}):(\d{2})/); if (!m) return 1e9;
  let h = Number(m[1]) % 12; const min = Number(m[2]);
  if (/pm|م/i.test(t)) h += 12; else if (!/am|ص/i.test(t) && Number(m[1]) >= 12) h = Number(m[1]);
  return h * 60 + min;
}
