// Arabic text utilities – isomorphic (server + browser)

const AR_INDIC = '٠١٢٣٤٥٦٧٨٩';
const FA_INDIC = '۰۱۲۳۴۵۶۷۸۹';

export function toWesternDigits(s: string): string {
  return s.replace(/[٠-٩۰-۹]/g, (c) => {
    const i = AR_INDIC.indexOf(c);
    return String(i >= 0 ? i : FA_INDIC.indexOf(c));
  });
}

/** Display digits on every screen. Clinic choice: always 0-9 (123), never ١٢٣ – the name is kept for the call sites.
 *  Set USE_INDIC_DIGITS = true to bring back ١٢٣. */
const USE_INDIC_DIGITS = false;
export function toArabicDigits(v: number | string | null | undefined): string {
  if (v === null || v === undefined || v === '') return '';
  return USE_INDIC_DIGITS ? String(v).replace(/[0-9]/g, (d) => AR_INDIC[Number(d)]) : toWesternDigits(String(v));
}

/** Aggressive normalisation for matching headers, clinic names, keywords, duplicate names. */
export function normalizeAr(input: unknown): string {
  return toWesternDigits(String(input ?? ''))
    .replace(/[ً-ٰٟۖ-ۭ]/g, '') // tashkeel
    .replace(/ـ/g, '') // tatweel
    .replace(/[أإآٱ]/g, 'ا')
    .replace(/ى/g, 'ي')
    .replace(/ة/g, 'ه')
    .replace(/ؤ/g, 'و')
    .replace(/ئ/g, 'ي')
    .replace(/[‌-‏‪-‮﻿]/g, '') // bidi marks
    .toLowerCase()
    .replace(/[_\-–—:،,.()\[\]]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function phoneDigits(p: unknown): string {
  const d = toWesternDigits(String(p ?? '')).replace(/\D/g, '');
  // canonical Egyptian mobile: 01xxxxxxxxx
  if (d.startsWith('0020')) return '0' + d.slice(4);
  if (d.startsWith('20') && d.length === 12) return '0' + d.slice(2);
  if (d.length === 10 && d.startsWith('1')) return '0' + d;
  return d;
}

export function containsAny(haystack: string, needles: string[]): boolean {
  const h = normalizeAr(haystack);
  if (!h) return false;
  return needles.some((n) => {
    const nn = normalizeAr(n);
    return nn.length > 0 && h.includes(nn);
  });
}
