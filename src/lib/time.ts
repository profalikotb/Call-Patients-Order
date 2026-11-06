// Africa/Cairo date helpers (DST-safe via Intl)
import { toArabicDigits } from './arabic';

export const TZ = 'Africa/Cairo';

export function cairoDate(d: Date = new Date()): string {
  // en-CA gives yyyy-mm-dd
  return new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
}

export function cairoMinutes(d: Date = new Date()): number {
  const p = new Intl.DateTimeFormat('en-GB', { timeZone: TZ, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(d);
  return Number(p.find((x) => x.type === 'hour')!.value) * 60 + Number(p.find((x) => x.type === 'minute')!.value);
}

/** dd/MM/yyyy from yyyy-mm-dd */
export function fmtDate(iso: string | null | undefined, arabic = false): string {
  if (!iso) return '';
  const [y, m, d] = iso.slice(0, 10).split('-');
  const s = `${d}/${m}/${y}`;
  return arabic ? toArabicDigits(s) : s;
}

/** "19:30" → "7:30 م" / "7:30 PM" */
export function fmtTime12(hhmm: string | null | undefined, lang: 'ar' | 'en' = 'ar'): string {
  if (!hhmm) return '';
  const [h, m] = hhmm.split(':').map(Number);
  if (Number.isNaN(h)) return hhmm;
  const pm = h >= 12;
  const h12 = h % 12 === 0 ? 12 : h % 12;
  const s = `${h12}:${String(m).padStart(2, '0')}`;
  return lang === 'ar' ? `${toArabicDigits(s)} ${pm ? 'م' : 'ص'}` : `${s} ${pm ? 'PM' : 'AM'}`;
}

export function fmtTs12(ts: string | number | Date | null | undefined, lang: 'ar' | 'en' = 'ar'): string {
  if (!ts) return '';
  const d = new Date(ts);
  const hm = new Intl.DateTimeFormat('en-GB', { timeZone: TZ, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(d);
  return fmtTime12(hm, lang);
}

export function minutesToHHMM(min: number): string {
  return `${String(Math.floor(min / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`;
}
