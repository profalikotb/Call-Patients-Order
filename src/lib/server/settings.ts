import { db } from './db';
import { mergeSettings, DEFAULT_SHEET_CONFIG, type ClinicSettings, type ClinicRef, type SheetConfig } from '../config';

const TTL = 5000;
const cache = new Map<string, { at: number; v: any }>();
async function cached<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const c = cache.get(key);
  if (c && Date.now() - c.at < TTL) return c.v;
  const v = await fn();
  cache.set(key, { at: Date.now(), v });
  return v;
}
export function bust() { cache.clear(); }

export const getClinics = () => cached<ClinicRef[]>('clinics', async () => {
  const { data, error } = await db().from('clinics').select('*').order('sort');
  if (error) throw error;
  return data as ClinicRef[];
});

export async function getClinic(id: string): Promise<ClinicRef | null> {
  return (await getClinics()).find((c) => c.id === id) ?? null;
}

export const getClinicSettings = (id: string) => cached<ClinicSettings>(`s:${id}`, async () => {
  const { data } = await db().from('clinic_settings').select('*').eq('clinic_id', id).maybeSingle();
  return mergeSettings(data, id);
});

export const getSheetConfig = () => cached<SheetConfig>('sheet', async () => {
  const { data } = await db().from('app_config').select('value').eq('key', 'sheet').maybeSingle();
  return { ...DEFAULT_SHEET_CONFIG, ...(data?.value ?? {}) };
});
