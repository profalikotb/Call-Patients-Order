// Demo mode: realistic sample bookings for *today*, re-shuffled on every read to prove that
// sheet re-sorting never creates duplicates or changes queue numbers.
import { cairoDate } from '../time';

const NAMES = [
  'محمد أحمد عبد الله', 'فاطمة محمود حسن', 'أحمد سيد إبراهيم', 'منى عبد الرحمن علي', 'خالد مصطفى كامل',
  'نادية فؤاد سالم', 'عمرو حسين شعبان', 'هالة إسماعيل يوسف', 'سامي عادل نجيب', 'إيمان طارق رشاد',
  'يوسف عبد العزيز فهمي', 'رانيا مجدي سعيد', 'حسن محمد عبد الحميد', 'سعاد عبد الفتاح', 'وليد شريف منصور',
  'دعاء حمدي جاد', 'مصطفى رجب عيسى', 'ابتسام صلاح الدين', 'كريم أشرف زكي', 'نجلاء عثمان بدر',
];
const PROC = ['كشف', 'استشارة', 'كشف', 'متابعة', 'كشف', 'مراجعة أشعة'];

function fmt(iso: string) { const [y, m, d] = iso.split('-'); return `${d}/${m}/${y}`; }
function t12(min: number) {
  const h = Math.floor(min / 60), m = min % 60, h12 = h % 12 || 12;
  return `${h12}:${String(m).padStart(2, '0')} ${h >= 12 ? 'PM' : 'AM'}`;
}

export function demoValues(): unknown[][] {
  const today = fmt(cairoDate());
  const yesterday = fmt(cairoDate(new Date(Date.now() - 86400000)));
  const rows: unknown[][] = [];
  NAMES.slice(0, 14).forEach((n, i) => rows.push([
    `HEL-${1001 + i}`, today, t12(18 * 60 + i * 10), 'مصر الجديدة', n,
    `01${String(100000000 + i * 7919).slice(0, 9)}`, i === 6 ? 'إلغاء' : PROC[i % PROC.length],
  ]));
  NAMES.slice(6, 16).forEach((n, i) => rows.push([
    `TKH-${2001 + i}`, today, t12(14 * 60 + i * 10), 'طوخ', n,
    `01${String(200000000 + i * 104729).slice(0, 9)}`, PROC[(i + 2) % PROC.length],
  ]));
  // same patient booked twice today (different IDs) → flagged as possible duplicate
  rows.push(['HEL-1099', today, t12(20 * 60 + 30), 'مصر الجديدة', NAMES[1], `01${String(100000000 + 7919).slice(0, 9)}`, 'متابعة']);
  // historical row → must be ignored
  rows.push(['HEL-0999', yesterday, t12(19 * 60), 'مصر الجديدة', 'مريض أمس', '01000000000', 'كشف']);
  for (let i = rows.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [rows[i], rows[j]] = [rows[j], rows[i]]; }
  return [['معرف الحجز', 'التاريخ', 'الوقت', 'العيادة', 'الاسم', 'رقم واتساب', 'الإجراء'], ...rows];
}
