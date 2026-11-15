// Daily backup: money + recent patient data → JSON (gzip) in the private storage bucket «backups».
// Protects against mistakes (e.g. «مسح بيانات اليوم») – the admin can also download a full copy any time.
import { gzipSync } from 'node:zlib';
import { db } from './db';
import { cairoDate } from '@/lib/time';

const BUCKET = 'backups';
const KEEP = 90;                                         // keep the last 90 daily files

async function all(table: string, build?: (q: any) => any): Promise<any[]> {
  const out: any[] = [];
  for (let from = 0; ; from += 1000) {
    let q = db().from(table).select('*');
    if (build) q = build(q);
    const { data, error } = await q.range(from, from + 999);
    if (error) { if (/does not exist|schema cache/.test(error.message)) return out; throw new Error(`${table}: ${error.message}`); }
    out.push(...(data ?? []));
    if (!data || data.length < 1000) return out;
  }
}
const daysAgo = (n: number) => { const d = new Date(`${cairoDate()}T12:00:00Z`); d.setUTCDate(d.getUTCDate() - n); return d.toISOString().slice(0, 10); };

/** full = everything (download); otherwise money tables fully + the last 21 days of patients */
export async function makeBackup(full = false) {
  const since = full ? '2000-01-01' : daysAgo(21);
  const recent = (q: any) => q.gte('service_date', since);
  const data = {
    made_at: new Date().toISOString(), cairo_date: cairoDate(), full,
    day_closing: await all('day_closing'),
    payment_log: await all('payment_log'),
    entry_payments: await all('entry_payments'),
    app_config: (await all('app_config')).filter((r) => r.key !== 'alert_state'),
    clinics: await all('clinics'),
    clinic_settings: await all('clinic_settings'),
    clinic_sessions: await all('clinic_sessions', recent),
    queue_entries: await all('queue_entries', recent),
    booking_links: await all('booking_links', recent),
  };
  const counts = Object.fromEntries(Object.entries(data).filter(([, v]) => Array.isArray(v)).map(([k, v]) => [k, (v as any[]).length]));
  return { data, counts };
}

export async function storeDailyBackup() {
  const { data, counts } = await makeBackup(false);
  const s = db().storage;
  const { data: b } = await s.getBucket(BUCKET);
  if (!b) await s.createBucket(BUCKET, { public: false });
  const name = `${cairoDate()}.json.gz`;
  const up = await s.from(BUCKET).upload(name, gzipSync(Buffer.from(JSON.stringify(data))), { contentType: 'application/gzip', upsert: true });
  if (up.error) throw new Error(up.error.message);
  const { data: files } = await s.from(BUCKET).list('', { limit: 1000, sortBy: { column: 'name', order: 'desc' } });
  const old = (files ?? []).map((f) => f.name).filter((n) => /^\d{4}-\d{2}-\d{2}\.json\.gz$/.test(n)).slice(KEEP);
  if (old.length) await s.from(BUCKET).remove(old);
  return { file: name, counts, removed: old.length };
}
