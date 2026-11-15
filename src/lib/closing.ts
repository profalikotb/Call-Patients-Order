// End-of-clinic closing – same fields and math as the Access CASES form.
export const EXPENSES: [key: string, ar: string, en: string][] = [
  ['mohamed_day', 'محمد – يومية', 'Mohamed Day'],
  ['mohamed_salary', 'محمد – مرتب', 'Mohamed Salary'],
  ['mohamed_clean', 'محمد – نظافة', 'Mohamed Clean'],
  ['naser_clean', 'ناصر – نظافة', 'Naser Clean'],
  ['bawab', 'البواب والصيانة', 'Bawab and Mentainace'],
  ['parking', 'الجراج', 'Parking'],
  ['electricity', 'كهرباء وغاز', 'Electricity and Gas'],
  ['running', 'مصاريف تشغيل', 'Running Cost'],
  ['tukh', 'طوخ', 'Tukh'],
  ['others', 'أخرى', 'Others'],
];
export interface Closing { no_cases: number; fees_back: number; fees: number; notes_other: string; notes: string; [k: string]: number | string }
const num = (v: unknown) => Number(String(v ?? '').replace(/[٠-٩]/g, (d) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(d))).replace(/[^\d.-]/g, '')) || 0;
export function calcClosing(c: Partial<Closing>, ddmmyyyy: string) {
  const net_number = num(c.no_cases) - num(c.fees_back);
  const net_fees = net_number * num(c.fees);
  const exp = EXPENSES.reduce((t, [k]) => t + num(c[k]), 0);
  const grand_net = net_fees - exp;
  // Daily Report – same style as Access: "15/11/2026, of  Mohamed Day, 100, Parking, 20, Final Total, -120"
  const parts = EXPENSES.filter(([k]) => num(c[k]) !== 0).map(([k, , en]) => `${en}, ${num(c[k])}`);
  if (net_fees) parts.unshift(`Cases, ${net_number}, Fees, ${num(c.fees)}, NetFees, ${net_fees}`);
  const report = `${ddmmyyyy}, of  ${parts.join(', ')}${parts.length ? ', ' : ''}Final Total, ${grand_net}`
    + (String(c.notes_other ?? '').trim() ? ` – Others: ${String(c.notes_other).trim()}` : '')
    + (String(c.notes ?? '').trim() ? ` – Notes: ${String(c.notes).trim()}` : '');
  return { net_number, net_fees, exp, grand_net, report };
}
export { num as closingNum };
