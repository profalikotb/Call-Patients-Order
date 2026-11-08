import { handle, json, requireStaff } from '@/lib/server/http';
import { syncAll } from '@/lib/server/sync';
import { sheetSource } from '@/lib/server/sheets';
import { rpc } from '@/lib/server/db';
import { cairoDate } from '@/lib/time';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const POST = handle(async (req) => {
  await requireStaff();
  const { force } = await req.json().catch(() => ({}));
  if (sheetSource() === 'push') {
    // the list comes from the clinic PC: a manual refresh asks that PC to push now (it checks every ~10 s)
    if (!force) return json({ ok: true, skipped: true, source: 'push' });
    const r = await rpc<any>('push_request', { p_date: cairoDate() }).catch((e) => {
      throw new Error(/push_request/.test(String(e?.message)) ? 'Run supabase/migrations/005_push_lease.sql in Supabase first' : e?.message);
    });
    return json({ ok: true, requested: true, source: 'push', owner: r?.owner ?? null, seen_seconds_ago: r?.seen_seconds_ago ?? null });
  }
  return json(await syncAll(!!force));
});
