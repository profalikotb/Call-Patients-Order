import { handle, json, requireStaff, HttpError } from '@/lib/server/http';
import { syncAll } from '@/lib/server/sync';
import { sheetSource } from '@/lib/server/sheets';
import { rpc } from '@/lib/server/db';
import { cairoDate } from '@/lib/time';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const need006 = (e: any) => {
  const m = String(e?.message || e);
  throw new Error(/push_(request|status)/.test(m) ? 'Run supabase/migrations/006_push_sources.sql and 007_push_choice.sql in Supabase first' : m);
};

// GET → which clinic PCs are on and which one is sending today's list (push mode)
export const GET = handle(async () => {
  await requireStaff();
  if (sheetSource() !== 'push') return json({ ok: true, source: sheetSource(), sources: [] });
  const r = await rpc<any>('push_status', { p_date: cairoDate() }).catch(need006);
  return json({ ok: true, source: 'push', ...r });
});

// POST {force, pc?}  push mode: force = ask the sending PC to push now; pc = switch today's list to that PC
export const POST = handle(async (req) => {
  await requireStaff();
  const { force, pc } = await req.json().catch(() => ({}));
  if (sheetSource() === 'push') {
    if (!force && !pc) return json({ ok: true, skipped: true, source: 'push' });
    const name = pc ? String(pc).trim().slice(0, 40) : null;
    const r = await rpc<any>('push_request', { p_date: cairoDate(), p_source: name }).catch(need006);
    if (!r?.ok) throw new HttpError(409, r?.error === 'pc_offline'
      ? `${r.label || name} غير متصل الآن – شغّل الجهاز وتأكد من الإنترنت`
      : `جهاز غير معروف: ${name}`);
    return json({ ok: true, requested: true, source: 'push', owner: r.owner ?? null, label: r.label ?? r.owner ?? null,
      pinned: !!r.pinned, seen_seconds_ago: r.seen_seconds_ago ?? null, pc_error: r.error ?? null });
  }
  return json(await syncAll(!!force));
});
