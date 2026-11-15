// Vercel Cron (vercel.json) – daily backup at 07:00 UTC (09:00 Cairo, after the night clinic).
import { NextRequest } from 'next/server';
import { json } from '@/lib/server/http';
import { storeDailyBackup } from '@/lib/server/backup';
import { clean } from '@/lib/envClean';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function GET(req: NextRequest) {
  const secret = clean(process.env.CRON_SECRET);
  const auth = clean(req.headers.get('authorization'));
  const ok = secret ? auth === secret : /vercel-cron/i.test(req.headers.get('user-agent') ?? '') || (!!clean(process.env.QUEUE_API_TOKEN) && auth === clean(process.env.QUEUE_API_TOKEN));
  if (!ok) return json({ ok: false, error: 'forbidden' }, 403);
  try { return json({ ok: true, ...(await storeDailyBackup()) }); }
  catch (e: any) { return json({ ok: false, error: String(e?.message || e) }, 500); }
}
