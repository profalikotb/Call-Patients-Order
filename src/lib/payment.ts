// Payment method per patient. Default = فوري (no row stored).
export type PayMethod = 'fawry' | 'instapay' | 'refund';
export const PAY_DEFAULT: PayMethod = 'fawry';
export const PAY: Record<PayMethod, { ar: string; icon: string; cls: string }> = {
  fawry:    { ar: 'فوري',         icon: '⚡', cls: 'bg-[#FFD200] text-[#0B2A6F] ring-1 ring-[#0B2A6F]/40' },
  instapay: { ar: 'انستاباي',     icon: '📱', cls: 'bg-gradient-to-l from-[#4B1E78] to-[#8A3FC8] text-white' },
  refund:   { ar: 'تم رد الكشف', icon: '↩', cls: 'bg-rose-600 text-white' },
};
export const PAY_ORDER: PayMethod[] = ['fawry', 'instapay', 'refund'];
export const payOf = (m: unknown): PayMethod => (m === 'instapay' || m === 'refund' ? m : PAY_DEFAULT);

// Payment applies to كشف only – استشارة is free.
export const isKashf = (proc: unknown) => /كشف/.test(String(proc ?? ''));
export interface PayTotals { fawry: number; instapay: number; refund: number; paid: number; fee: number; total: number; fawrySum: number; instapaySum: number; refundSum: number }
// paid = كشف not cancelled and not refunded; a cancelled كشف counts only if marked «تم رد الكشف»
export function payTotals(entries: any[], fee: number): PayTotals {
  const k = entries.filter((e) => isKashf(e.procedure));
  const n = (m: PayMethod) => k.filter((e) => payOf(e.payment) === m && (m === 'refund' || e.status !== 'cancelled')).length;
  const fawry = n('fawry'), instapay = n('instapay'), refund = n('refund');
  const f = Math.max(0, Number(fee) || 0);
  return { fawry, instapay, refund, paid: fawry + instapay, fee: f, fawrySum: fawry * f, instapaySum: instapay * f, refundSum: refund * f, total: (fawry + instapay) * f };
}
export const egp = (n: number) => `${Math.round(n).toLocaleString('en-US')} ج.م`;
