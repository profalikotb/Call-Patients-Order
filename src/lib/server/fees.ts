// كشف fee per clinic – stored in app_config key 'fees' = { heliopolis: 500, toukh: 300 } (no migration needed)
import { db } from './db';
export async function getFee(clinic: string): Promise<number> {
  const { data } = await db().from('app_config').select('value').eq('key', 'fees').maybeSingle();
  return Number((data?.value as any)?.[clinic]) || 0;
}
export async function setFee(clinic: string, fee: number) {
  const d = db();
  const { data } = await d.from('app_config').select('value').eq('key', 'fees').maybeSingle();
  const value = { ...((data?.value as any) ?? {}), [clinic]: Math.max(0, Math.round(fee)) };
  const { error } = await d.from('app_config').upsert({ key: 'fees', value, updated_at: new Date().toISOString() }, { onConflict: 'key' });
  if (error) throw error;
}
export async function getFees(): Promise<Record<string, number>> {
  const { data } = await db().from('app_config').select('value').eq('key', 'fees').maybeSingle();
  return ((data?.value as any) ?? {}) as Record<string, number>;
}
