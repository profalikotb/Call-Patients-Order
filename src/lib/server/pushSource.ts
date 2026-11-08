// Which clinic PC sends today's list (desktop push mode) – helpers for the Access buttons.
import { db, rpc } from './db';

export function clientIp(req: Request): string {
  return (req.headers.get('x-forwarded-for') || req.headers.get('x-real-ip') || '').split(',')[0].trim();
}

/** called on every push / poll: remember the PC's Windows name + internet address (needs migration 008) */
export async function notePcAddress(name: string, host: string, ip: string) {
  if (!name || (!host && !ip)) return;
  try { await db().from('push_sources').update({ host: host || null, ip: ip || null }).eq('name', name); } catch { /* 008 not run */ }
}

/** the push PC that is the same computer as the caller (Windows name + same internet line), if it is on */
export async function pcForCaller(host: string, ip: string): Promise<string | null> {
  try {
    const since = new Date(Date.now() - 120_000).toISOString();
    const { data, error } = await db().from('push_sources').select('name, host, ip').gt('last_seen_at', since);
    if (error || !data?.length) return null;
    const H = host.toUpperCase();
    const byHost = data.filter((p: any) => (p.host || '').toUpperCase() === H);
    const both = byHost.filter((p: any) => ip && p.ip === ip);
    if (both.length === 1) return both[0].name;
    if (byHost.length === 1) return byHost[0].name;
    const byIp = data.filter((p: any) => ip && p.ip === ip && !p.host);
    return byIp.length === 1 ? byIp[0].name : null;
  } catch { return null; }
}

export async function pushOwner(date: string): Promise<{ owner: string | null; seen: number }> {
  const { data } = await db().from('push_state').select('owner, owner_seen_at').eq('service_date', date).maybeSingle();
  return { owner: data?.owner ?? null, seen: data?.owner_seen_at ? Date.parse(data.owner_seen_at) : 0 };
}

/** ask a PC (or the current owner) to push now and wait until its list has arrived (PCs check every ~10 s) */
export async function requestPushAndWait(date: string, pc: string | null, maxMs = 14_000):
    Promise<{ ok: boolean; owner: string | null; error?: string }> {
  const t0 = Date.now();
  const r = await rpc<any>('push_request', { p_date: date, p_source: pc }).catch((e) => ({ ok: false, error: String(e?.message || e) }));
  if (!r?.ok) return { ok: false, owner: null, error: r?.error === 'pc_offline' ? `${r.label || pc} is off / offline` : r?.error };
  const target = pc ?? r.owner ?? null;
  while (Date.now() - t0 < maxMs) {
    await new Promise((res) => setTimeout(res, 1000));
    const o = await pushOwner(date);
    if (o.owner === target && o.seen >= t0 - 500) return { ok: true, owner: target };
  }
  let err: string | undefined;
  if (target) {
    const { data } = await db().from('push_sources').select('label, last_error').eq('name', target).maybeSingle();
    err = `${data?.label || target} did not send its list${data?.last_error ? ': ' + data.last_error : ' (is Oracle running on it?)'}`;
  }
  return { ok: false, owner: target, error: err };
}
