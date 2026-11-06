import { describe, it, expect } from 'vitest';
import { parseSheet } from '../src/lib/sheetParse';
import { DEFAULT_SHEET_CONFIG, type ClinicRef } from '../src/lib/config';

const clinics: ClinicRef[] = [
  { id: 'heliopolis', name_ar: 'عيادة مصر الجديدة', name_en: 'Heliopolis Clinic', sheet_aliases: ['مصر الجديدة', 'مصر الجديده'], active: true, sort: 1 },
  { id: 'toukh', name_ar: 'عيادة طوخ', name_en: 'Toukh Clinic', sheet_aliases: ['طوخ'], active: true, sort: 2 },
];
// exactly what PDF.gs doGet returns (getDisplayValues) for QUEUE_TODAY
const values = [
  ['رقم النداء', 'رقم الحجز', 'التاريخ', 'العيادة', 'اسم المريض', 'التليفون', 'نوع الكشف', 'الحالة', 'كود المريض'],
  ['9', '28805', '06/11/2026', 'طوخ', 'إيمان الطوخى رضوان', '013/', '1', '', '55'],
  ['3', '28806', '06/11/2026', 'طوخ', 'أحمد على عاشور', '013/2700883', '2', 'تم الكشف', '2'],
  ['8', '28807', '06/11/2026', 'طوخ', 'أسماء حسن حلاوة', '013/2462463', '1', '', '3'],
  ['10', '28808', '06/11/2026', 'وادي النيل', 'مريض وادي النيل', '', '1', '', '9'],
];

describe('Oracle QUEUE_TODAY tab', () => {
  it('maps columns, routes by clinic, keeps booking order, seen ≠ cancelled', () => {
    const r = parseSheet(values, DEFAULT_SHEET_CONFIG, clinics, '2026-11-06');
    expect(DEFAULT_SHEET_CONFIG.tab).toBe('QUEUE_TODAY');
    expect(r.map.call_no).toBe(0);
    expect(r.map.booking_id).toBe(1);
    expect(r.map.date).toBe(2);
    expect(r.map.clinic).toBe(3);
    expect(r.map.name).toBe(4);
    expect(r.map.phone).toBe(5);
    expect(r.map.action).toBe(6);
    expect(r.map.status).toBe(7);
    const t = r.rowsByClinic.toukh;
    expect(t.map((x) => [x.booking_id, x.call_no])).toEqual([['28806', 3], ['28807', 8], ['28805', 9]]);
    expect(t.every((x) => !x.cancelled)).toBe(true);
    expect(t.find((x) => x.booking_id === '28805')!.name).toBe('إيمان الطوخى رضوان');
    expect(r.rowsByClinic.heliopolis).toBeUndefined();
    expect(r.stats.unknownClinic).toBe(1);
  });
});
