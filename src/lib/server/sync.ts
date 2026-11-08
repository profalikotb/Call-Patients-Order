import { rpc } from './db';
import { getClinics, getSheetConfig } from './settings';
import { readSheetValues } from './sheets';
import { parseSheet } from '../sheetParse';
import { cairoDate } from '../time';

export interface SyncReport { ok: boolean; skipped?: boolean; clinics: Record<string, any>; stats?: any; missing?: string[]; error?: string }

/** One sheet read feeds every clinic. Throttled per clinic in the DB so N open dashboards ≠ N reads. */
export async function syncAll(force = false): Promise<SyncReport> {
  const today = cairoDate();
  const clinics = (await getClinics()).filter((c) => c.active);
  const claimed: string[] = [];
  for (const c of clinics) {
    if (await rpc<boolean>('sync_claim', { p_clinic: c.id, p_date: today, p_min_seconds: force ? 2 : 8 })) claimed.push(c.id);
  }
  if (!claimed.length) return { ok: true, skipped: true, clinics: {} };
  try {
    const cfg = await getSheetConfig();
    const values = await readSheetValues(cfg.tab, force ? 0 : 3000);
    const parsed = parseSheet(values, cfg, clinics, today);
    if (parsed.map.date < 0 || parsed.map.name < 0) throw new Error(`لم يتم التعرف على أعمدة: ${parsed.missing.join(', ')}`);
    const out: Record<string, any> = {};
    for (const id of claimed) {
      const rows = parsed.rowsByClinic[id] ?? [];
      out[id] = await rpc('queue_sync', { p_clinic: id, p_date: today, p_rows: rows, p_complete: true });
      // already examined in Oracle → done in the queue (needs migration 003; ignored if not installed)
      const seenKeys = rows.filter((r: any) => r.seen).map((r: any) => r.booking_key);
      if (seenKeys.length) {
        try { out[id].seen_done = await rpc('queue_mark_seen', { p_clinic: id, p_date: today, p_keys: seenKeys }); }
        catch (e: any) { out[id].seen_error = String(e?.message || e); }
      }
    }
    return { ok: true, clinics: out, stats: parsed.stats, missing: parsed.missing };
  } catch (e: any) {
    const msg = String(e?.message || e);
    await Promise.all(claimed.map((id) => rpc('sync_fail', { p_clinic: id, p_date: today, p_error: msg }).catch(() => {})));
    return { ok: false, clinics: {}, error: msg };
  }
}
