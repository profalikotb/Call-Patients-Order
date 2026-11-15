// Payment method per patient. Default = فوري (no row stored).
export type PayMethod = 'fawry' | 'instapay' | 'refund';
export const PAY_DEFAULT: PayMethod = 'fawry';
export const PAY: Record<PayMethod, { ar: string; icon: string; cls: string }> = {
  fawry:    { ar: 'فوري',         icon: '⚡', cls: 'bg-amber-400 text-black' },
  instapay: { ar: 'انستاباي',     icon: '📱', cls: 'bg-violet-700 text-white' },
  refund:   { ar: 'تم رد الكشف', icon: '↩', cls: 'bg-rose-600 text-white' },
};
export const PAY_ORDER: PayMethod[] = ['fawry', 'instapay', 'refund'];
export const payOf = (m: unknown): PayMethod => (m === 'instapay' || m === 'refund' ? m : PAY_DEFAULT);
