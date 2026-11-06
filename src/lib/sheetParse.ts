// Pure parsing of Google Sheet values → today's bookings per clinic. Unit-tested.
import { normalizeAr, toWesternDigits, phoneDigits, containsAny } from './arabic';
import { cairoDate, cairoMinutes, minutesToHHMM } from './time';
import { FIELDS, type Field, type SheetConfig, type ClinicRef } from './config';

const SYNONYMS: Record<Field, string[]> = {
  booking_id: ['معرف الحجز', 'رقم الحجز', 'كود الحجز', 'id الحجز', 'booking id', 'bookingid', 'booking_id', 'reservation id', 'id'],
  date: ['التاريخ', 'تاريخ الحجز', 'تاريخ الكشف', 'تاريخ الموعد', 'اليوم', 'date'],
  time: ['الوقت', 'الميعاد', 'الموعد', 'وقت الحجز', 'وقت الكشف', 'الساعه', 'time', 'slot'],
  clinic: ['العياده', 'الفرع', 'المكان', 'مكان الكشف', 'clinic', 'branch', 'location'],
  name: ['الاسم', 'اسم المريض', 'الاسم بالكامل', 'اسم الحاله', 'المريض', 'name', 'patient', 'patient name'],
  phone: ['رقم واتساب', 'واتساب', 'رقم الواتساب', 'رقم الموبايل', 'الموبايل', 'الهاتف', 'رقم الهاتف', 'التليفون', 'phone', 'whatsapp', 'mobile'],
  action: ['الاجراء', 'نوع الكشف', 'نوع الزياره', 'الخدمه', 'نوع الحجز', 'procedure', 'action', 'type'],
  status: ['الحاله', 'حاله الحجز', 'status', 'state'],
  // fixed calling number decided upstream (e.g. Oracle → WaitingListToday). When present it IS the queue number.
  call_no: ['رقم النداء', 'رقم الدور', 'رقم النداء الثابت', 'call no', 'call number', 'queue no', 'queue number'],
};

export function autoMap(headers: string[], overrides: SheetConfig['mapping'] = {}): Record<Field, number> {
  const norm = headers.map((h) => normalizeAr(h));
  const used = new Set<number>();
  const out = {} as Record<Field, number>;
  for (const f of FIELDS) {
    let idx = -1;
    const ov = overrides[f];
    if (ov) idx = norm.indexOf(normalizeAr(ov));
    if (idx < 0) for (const syn of SYNONYMS[f]) {                 // exact
      const i = norm.findIndex((h, k) => !used.has(k) && h === normalizeAr(syn));
      if (i >= 0) { idx = i; break; }
    }
    if (idx < 0) for (const syn of SYNONYMS[f]) {                 // contains (skip tiny tokens like "id")
      const s = normalizeAr(syn);
      if (s.length < 4) continue;
      const i = norm.findIndex((h, k) => !used.has(k) && h.includes(s));
      if (i >= 0) { idx = i; break; }
    }
    if (idx >= 0) used.add(idx);
    out[f] = idx;
  }
  return out;
}

const SERIAL_EPOCH = Date.UTC(1899, 11, 30);

export function parseDateCell(v: unknown, order: 'dmy' | 'mdy' = 'dmy'): string | null {
  if (v === null || v === undefined || v === '') return null;
  if (typeof v === 'number') {
    if (v < 20000) return null;                               // not a date serial
    const d = new Date(SERIAL_EPOCH + Math.floor(v) * 86400000);
    return d.toISOString().slice(0, 10);
  }
  if (v instanceof Date) return cairoDate(v);
  const s = toWesternDigits(String(v)).trim();
  if (/^\d{4}-\d{2}-\d{2}T/.test(s)) return cairoDate(new Date(s)); // instant (e.g. Apps Script JSON)
  let m = s.match(/^(\d{4})[\/\-.](\d{1,2})[\/\-.](\d{1,2})/);
  if (m) return iso(+m[1], +m[2], +m[3]);
  m = s.match(/^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2,4})/);
  if (m) {
    let a = +m[1], b = +m[2], y = +m[3];
    if (y < 100) y += 2000;
    let day = order === 'dmy' ? a : b, mon = order === 'dmy' ? b : a;
    if (a > 12 && b <= 12) { day = a; mon = b; } else if (b > 12 && a <= 12) { day = b; mon = a; }
    return iso(y, mon, day);
  }
  return null;
}

function iso(y: number, m: number, d: number): string | null {
  if (m < 1 || m > 12 || d < 1 || d > 31) return null;
  return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

/** returns minutes after midnight */
export function parseTimeCell(v: unknown): number | null {
  if (v === null || v === undefined || v === '') return null;
  if (typeof v === 'number') {
    const frac = v % 1;
    if (frac === 0 && v >= 1) return null;
    return Math.round(frac * 1440) % 1440;
  }
  if (v instanceof Date) return cairoMinutes(v);
  const s = toWesternDigits(String(v)).trim().toLowerCase();
  if (/^\d{4}-\d{2}-\d{2}t/.test(s)) return cairoMinutes(new Date(s));
  const m = s.replace(/^\d{4}-\d{2}-\d{2}\s+/, '').replace(/^\d{1,2}\/\d{1,2}\/\d{2,4}\s+/, '').match(/(\d{1,2})(?:[:.](\d{2}))?(?::\d{2})?\s*(.*)$/);
  if (!m) return null;
  let h = +m[1];
  const min = m[2] ? +m[2] : 0;
  const suf = normalizeAr(m[3] || '');
  const pm = /(^|\s)(م|مساء|مساءا|pm|p m|بعد الظهر|ليلا)/.test(suf) || suf === 'م';
  const am = /(^|\s)(ص|صباحا|صباح|am|a m)/.test(suf) || suf === 'ص';
  if (!m[2] && !pm && !am) return null;                       // a bare number is not a time
  if (pm && h < 12) h += 12;
  if (am && h === 12) h = 0;
  if (h > 23 || min > 59) return null;
  return h * 60 + min;
}

// small sync hash for fallback identities (cyrb53)
export function hashKey(str: string): string {
  let h1 = 0xdeadbeef, h2 = 0x41c6ce57;
  for (let i = 0; i < str.length; i++) {
    const ch = str.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36);
}

export interface ParsedRow {
  booking_key: string;
  booking_id: string | null;
  name: string;
  phone: string | null;
  appt_time: string | null;
  appt_minutes: number | null;
  procedure: string | null;
  cancelled: boolean;
  dup_hint: string | null;
  call_no: number | null;       // fixed calling number from the sheet (optional)
}

export interface ParseResult {
  headers: string[];
  map: Record<Field, number>;
  missing: Field[];
  rowsByClinic: Record<string, ParsedRow[]>;
  stats: { total: number; today: number; cancelled: number; unknownClinic: number; noDate: number; duplicateRows: number };
}

export function matchClinic(value: unknown, clinics: ClinicRef[]): string | null {
  const v = normalizeAr(value);
  if (!v) return null;
  for (const c of clinics) {
    const names = [c.id, c.name_ar, c.name_en, ...c.sheet_aliases];
    if (names.some((n) => { const nn = normalizeAr(n); return nn && (v === nn || v.includes(nn)); })) return c.id;
  }
  return null;
}

export function parseSheet(values: unknown[][], cfg: SheetConfig, clinics: ClinicRef[], today: string): ParseResult {
  const hr = Math.max(1, cfg.headerRow) - 1;
  const headers = (values[hr] ?? []).map((h) => String(h ?? '').trim());
  const map = autoMap(headers, cfg.mapping);
  const required: Field[] = ['date', 'name'];
  const missing = (['booking_id', 'date', 'time', 'clinic', 'name', 'phone', 'action'] as Field[]).filter((f) => map[f] < 0);
  const stats = { total: 0, today: 0, cancelled: 0, unknownClinic: 0, noDate: 0, duplicateRows: 0 };
  const byKey = new Map<string, { clinic: string; row: ParsedRow }>();
  if (required.some((f) => map[f] < 0)) return { headers, map, missing, rowsByClinic: {}, stats };

  const cell = (r: unknown[], f: Field) => (map[f] >= 0 ? r[map[f]] : undefined);
  const active = clinics.filter((c) => c.active);

  for (let i = hr + 1; i < values.length; i++) {
    const r = values[i] ?? [];
    if (!r.some((c) => String(c ?? '').trim() !== '')) continue;
    stats.total++;
    const date = parseDateCell(cell(r, 'date'), cfg.dateOrder);
    if (!date) { stats.noDate++; continue; }
    if (date !== today) continue;                              // historical & future excluded
    const clinicId = map.clinic >= 0 ? matchClinic(cell(r, 'clinic'), active) : cfg.defaultClinic;
    if (!clinicId) { stats.unknownClinic++; continue; }
    stats.today++;

    const name = String(cell(r, 'name') ?? '').trim();
    const phone = phoneDigits(cell(r, 'phone')) || null;
    const minutes = parseTimeCell(cell(r, 'time'));
    const rawId = toWesternDigits(String(cell(r, 'booking_id') ?? '')).replace(/\s+/g, '').trim();
    const procedure = String(cell(r, 'action') ?? '').trim() || null;
    const callRaw = toWesternDigits(String(cell(r, 'call_no') ?? '')).replace(/[^0-9]/g, '');
    const call_no = callRaw && Number(callRaw) > 0 && Number(callRaw) < 100000 ? Number(callRaw) : null;
    const cancelled = containsAny(procedure ?? '', cfg.cancelKeywords) || containsAny(String(cell(r, 'status') ?? ''), cfg.cancelKeywords);
    const key = rawId
      ? `id:${rawId}`
      : `h:${hashKey([date, minutes ?? '', normalizeAr(name), phone ?? ''].join('|'))}`;

    const row: ParsedRow = {
      booking_key: key, booking_id: rawId || null, name, phone,
      appt_time: minutes === null ? null : minutesToHHMM(minutes), appt_minutes: minutes,
      procedure, cancelled, dup_hint: null, call_no,
    };
    const prev = byKey.get(key);
    if (prev) {
      stats.duplicateRows++;
      // a cancellation anywhere wins (order-independent → safe under sorting); otherwise last row's data wins
      row.cancelled = row.cancelled || prev.row.cancelled;
    }
    byKey.set(key, { clinic: clinicId, row });
  }

  const rowsByClinic: Record<string, ParsedRow[]> = {};
  for (const { clinic, row } of byKey.values()) {
    if (row.cancelled) stats.cancelled++;
    (rowsByClinic[clinic] ??= []).push(row);
  }
  // same patient booked twice today (different booking IDs) → flag, never auto-merge
  for (const rows of Object.values(rowsByClinic)) {
    const groups = new Map<string, ParsedRow[]>();
    for (const r of rows) {
      if (r.cancelled) continue;
      const g = r.phone && r.phone.length >= 8 ? `p:${r.phone}` : r.name ? `n:${normalizeAr(r.name)}` : '';
      if (!g) continue;
      (groups.get(g) ?? groups.set(g, []).get(g)!).push(r);
    }
    for (const g of groups.values()) {
      if (g.length < 2) continue;
      for (const r of g) r.dup_hint = g.filter((o) => o !== r).map((o) => o.booking_id || o.appt_time || '?').join('، ');
    }
    rows.sort((a, b) => (a.call_no ?? 1e9) - (b.call_no ?? 1e9) || (a.appt_minutes ?? 9999) - (b.appt_minutes ?? 9999) || a.booking_key.localeCompare(b.booking_key));
  }
  return { headers, map, missing, rowsByClinic, stats };
}
