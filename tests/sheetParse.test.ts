import { describe, it, expect } from 'vitest';
import { parseSheet, parseDateCell, parseTimeCell, autoMap } from '@/lib/sheetParse';
import { DEFAULT_SHEET_CONFIG, type ClinicRef } from '@/lib/config';
import { normalizeAr, phoneDigits } from '@/lib/arabic';

const clinics: ClinicRef[] = [
  { id: 'heliopolis', name_ar: 'عيادة مصر الجديدة', name_en: 'Heliopolis', sheet_aliases: ['مصر الجديدة', 'هليوبوليس'], active: true, sort: 1 },
  { id: 'toukh', name_ar: 'عيادة طوخ', name_en: 'Toukh', sheet_aliases: ['طوخ'], active: true, sort: 2 },
];
const H = ['معرف الحجز', 'التاريخ', 'الوقت', 'العيادة', 'الاسم', 'رقم واتساب', 'الإجراء'];
const TODAY = '2026-11-05';

describe('normalisation', () => {
  it('Arabic letter variants & digits', () => {
    expect(normalizeAr('الإجراء')).toBe(normalizeAr('الاجراء'));
    expect(normalizeAr('العيادة')).toBe('العياده');
    expect(normalizeAr('على')).toBe(normalizeAr('علي'));
    expect(normalizeAr('١٢٣')).toBe('123');
  });
  it('Egyptian phones canonicalised', () => {
    expect(phoneDigits('+20 100 123 4567')).toBe('01001234567');
    expect(phoneDigits('٠١٠٠١٢٣٤٥٦٧')).toBe('01001234567');
    expect(phoneDigits('1001234567')).toBe('01001234567');
  });
});

describe('header auto-mapping', () => {
  it('maps the exact Arabic headers', () => {
    const m = autoMap(H);
    expect(m).toMatchObject({ booking_id: 0, date: 1, time: 2, clinic: 3, name: 4, phone: 5, action: 6, status: -1 });
  });
  it('handles alef/ta-marbuta variants, extra spaces, reordered columns', () => {
    const m = autoMap(['  اسم المريض ', 'رقم الحجز', 'العياده', 'تاريخ الكشف', 'الميعاد', 'واتساب', 'الاجراء']);
    expect(m).toMatchObject({ name: 0, booking_id: 1, clinic: 2, date: 3, time: 4, phone: 5, action: 6 });
  });
  it('manual override wins', () => {
    expect(autoMap(['A', 'B', 'التاريخ'], { date: 'B' }).date).toBe(1);
  });
});

describe('date & time cells', () => {
  it('serial numbers (Sheets UNFORMATTED_VALUE)', () => {
    expect(parseDateCell(46331)).toBe('2026-11-05');
    expect(parseTimeCell(0.8125)).toBe(19 * 60 + 30);
    expect(parseTimeCell(46331.8125)).toBe(19 * 60 + 30);
  });
  it('text formats incl. Arabic digits & AM/PM markers', () => {
    expect(parseDateCell('05/11/2026')).toBe('2026-11-05');
    expect(parseDateCell('٥/١١/٢٠٢٦')).toBe('2026-11-05');
    expect(parseDateCell('2026-11-05')).toBe('2026-11-05');
    expect(parseDateCell('11/25/2026', 'dmy')).toBe('2026-11-25'); // unambiguous swap
    expect(parseTimeCell('7:30 PM')).toBe(1170);
    expect(parseTimeCell('٧:٣٠ م')).toBe(1170);
    expect(parseTimeCell('07:30 ص')).toBe(450);
    expect(parseTimeCell('12:10 AM')).toBe(10);
    expect(parseTimeCell('19:30')).toBe(1170);
    expect(parseTimeCell('7 مساءً')).toBe(1140);
    expect(parseTimeCell('2026-11-05 19:30')).toBe(1170);
  });
  it('instant strings are converted to Cairo local date (midnight UTC trap)', () => {
    expect(parseDateCell('2026-11-04T22:30:00.000Z')).toBe('2026-11-05');
  });
  it('rejects garbage', () => { expect(parseDateCell('غدا')).toBeNull(); expect(parseTimeCell('12')).toBeNull(); });
});

describe('parseSheet', () => {
  const rows = [
    H,
    ['B-1', '05/11/2026', '7:00 PM', 'مصر الجديدة', 'أحمد', '01000000001', 'كشف'],
    ['B-2', '05/11/2026', '6:30 PM', 'مصر الجديده', 'منى', '01000000002', 'استشارة'],
    ['B-3', '05/11/2026', '6:40 PM', 'طوخ', 'سامي', '01000000003', 'كشف'],
    ['B-4', '04/11/2026', '6:40 PM', 'مصر الجديدة', 'أمس', '01000000004', 'كشف'],        // historical
    ['B-5', '05/11/2026', '8:00 PM', 'مصر الجديدة', 'ملغى', '01000000005', 'إلغاء'],       // cancelled
    ['B-6', '05/11/2026', '8:10 PM', 'وادي النيل', 'غير معروف', '01000000006', 'كشف'],  // other clinic
    ['', '', '', '', '', '', ''],
    ['B-1', '05/11/2026', '7:00 PM', 'مصر الجديدة', 'أحمد محمد', '01000000001', 'كشف'],  // duplicated row (edit)
    ['B-7', '05/11/2026', '8:20 PM', 'مصر الجديدة', 'منى', '01000000002', 'متابعة'],     // same patient, 2nd booking
    ['', '05/11/2026', '8:30 PM', 'مصر الجديدة', 'بلا معرف', '01000000008', 'كشف'],     // no ID → content hash
  ];
  const p = parseSheet(rows, DEFAULT_SHEET_CONFIG, clinics, TODAY);
  const hel = p.rowsByClinic.heliopolis;

  it('splits by clinic and keeps only today', () => {
    expect(p.rowsByClinic.toukh.map((r) => r.booking_id)).toEqual(['B-3']);
    expect(hel.some((r) => r.booking_id === 'B-4')).toBe(false);
    expect(p.stats.unknownClinic).toBe(1);
  });
  it('sorted by appointment time, de-duplicated by booking key (last data wins)', () => {
    expect(hel.map((r) => r.booking_id)).toEqual(['B-2', 'B-1', 'B-5', 'B-7', null]);
    expect(hel.find((r) => r.booking_id === 'B-1')!.name).toBe('أحمد محمد');
    expect(p.stats.duplicateRows).toBe(1);
  });
  it('detects cancellation from الإجراء', () => {
    expect(hel.find((r) => r.booking_id === 'B-5')!.cancelled).toBe(true);
  });
  it('flags same patient booked twice (does not merge)', () => {
    expect(hel.find((r) => r.booking_id === 'B-2')!.dup_hint).toBe('B-7');
    expect(hel.find((r) => r.booking_id === 'B-7')!.dup_hint).toBe('B-2');
  });
  it('stable identity independent of sheet row order', () => {
    const shuffled = [rows[0], ...rows.slice(1).reverse()];
    const q = parseSheet(shuffled, DEFAULT_SHEET_CONFIG, clinics, TODAY);
    const keys = (r: any) => r.rowsByClinic.heliopolis.map((x: any) => x.booking_key).sort();
    expect(keys(q)).toEqual(keys(p));
    expect(q.rowsByClinic.heliopolis.find((r) => r.booking_id === 'B-5')!.cancelled).toBe(true);
  });
  it('cancellation in any duplicate row wins regardless of order', () => {
    const r2 = [H, ['X-1', '05/11/2026', '7:00 PM', 'طوخ', 'أ', '', 'إلغاء'], ['X-1', '05/11/2026', '7:00 PM', 'طوخ', 'أ', '', 'كشف']];
    expect(parseSheet(r2, DEFAULT_SHEET_CONFIG, clinics, TODAY).rowsByClinic.toukh[0].cancelled).toBe(true);
  });
  it('missing required columns → no rows, reported', () => {
    const q = parseSheet([['x', 'y'], ['1', '2']], DEFAULT_SHEET_CONFIG, clinics, TODAY);
    expect(q.missing).toContain('date');
    expect(Object.keys(q.rowsByClinic)).toHaveLength(0);
  });
});
