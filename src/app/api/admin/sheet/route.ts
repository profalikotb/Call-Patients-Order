// Column-mapping preview: raw headers, auto/override mapping, and parsed rows for today.
import { handle, json, requireStaff } from '@/lib/server/http';
import { getClinics, getSheetConfig } from '@/lib/server/settings';
import { readSheetValues, sheetSource } from '@/lib/server/sheets';
import { parseSheet } from '@/lib/sheetParse';
import { cairoDate } from '@/lib/time';
import { DEFAULT_SHEET_CONFIG } from '@/lib/config';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const POST = handle(async (req) => {
  await requireStaff({ admin: true });
  const b = await req.json().catch(() => ({}));
  const cfg = { ...DEFAULT_SHEET_CONFIG, ...(await getSheetConfig()), ...(b.sheet ?? {}) };
  try {
    const values = await readSheetValues(cfg.tab, 0);
    const p = parseSheet(values, cfg, await getClinics(), cairoDate());
    const sample = Object.fromEntries(Object.entries(p.rowsByClinic).map(([k, v]) => [k, v.slice(0, 8)]));
    return json({ ok: true, source: sheetSource(), headers: p.headers, map: p.map, missing: p.missing, stats: p.stats, sample,
      rawSample: values.slice(cfg.headerRow, cfg.headerRow + 3) });
  } catch (e: any) {
    return json({ ok: false, source: sheetSource(), error: String(e?.message || e) }, 502);
  }
});
