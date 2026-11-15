// كشف fee per clinic WITH HISTORY – a price change applies from the session day it was set;
// earlier days keep the price that was valid then.
// app_config 'fees'        = { heliopolis: 500, toukh: 300 }                     (current price)
// app_config 'fee_history' = { heliopolis: [{from:'2000-01-01',fee:400},{from:'2026-11-15',fee:500}] }
import { db } from './db';
type Hist = Record<string, { from: string; fee: number }[]>;
const read = async (key: string) => ((await db().from('app_config').select('value').eq('key', key).maybeSingle()).data?.value ?? {}) as any;
const write = async (key: string, value: any) => {
  const { error } = await db().from('app_config').upsert({ key, value, updated_at: new Date().toISOString() }, { onConflict: 'key' });
  if (error) throw error;
};

// price of a كشف in this clinic on this day
export async function getFee(clinic: string, date?: string): Promise<number> {
  const [cur, hist] = await Promise.all([read('fees'), read('fee_history') as Promise<Hist>]);
  const h = (hist[clinic] ?? []).filter((x) => !date || x.from <= date).sort((a, b) => a.from.localeCompare(b.from));
  if (h.length) return Number(h[h.length - 1].fee) || 0;
  return (hist[clinic]?.length ? 0 : Number(cur[clinic]) || 0);
}
export async function setFee(clinic: string, fee: number, fromDate: string) {
  const f = Math.max(0, Math.round(fee));
  const [cur, hist] = await Promise.all([read('fees'), read('fee_history') as Promise<Hist>]);
  let h = [...(hist[clinic] ?? [])];
  if (!h.length && Number(cur[clinic]) > 0) h.push({ from: '2000-01-01', fee: Number(cur[clinic]) });   // keep the old price for past days
  if (!h.length) h.push({ from: '2000-01-01', fee: f });                                              // first price ever → all days
  else { h = h.filter((x) => x.from !== fromDate); h.push({ from: fromDate, fee: f }); }
  h.sort((a, b) => a.from.localeCompare(b.from));
  await write('fee_history', { ...hist, [clinic]: h });
  await write('fees', { ...cur, [clinic]: f });
}
export async function getFees(): Promise<Record<string, number>> { return (await read('fees')) as Record<string, number>; }
