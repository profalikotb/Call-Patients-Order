// Phone alerts for the doctor via ntfy (free push app for iPhone/Android – no account):
//   Vercel env ALERT_NTFY_TOPIC = a long random topic name (e.g. alikotb-queue-7f3k9q2m)
//   iPhone: install «ntfy» → ＋ → subscribe to the same topic name.
// Every alert is throttled per kind (app_config 'alert_state'), so it never spams.
import { db, rpc } from './db';
import { clean } from '../envClean';

const topic = () => clean(process.env.ALERT_NTFY_TOPIC);
export const alertsEnabled = () => !!topic();

export async function phoneAlert(title: string, body: string, opts: { tags?: string; priority?: 1 | 2 | 3 | 4 | 5 } = {}) {
  const t = topic(); if (!t) return false;
  try {   // JSON publish = safe for Arabic title/body
    const r = await fetch('https://ntfy.sh/', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ topic: t, title, message: body, tags: (opts.tags ?? 'hospital').split(','), priority: opts.priority ?? 4 }),
      signal: AbortSignal.timeout(5000),
    });
    return r.ok;
  } catch { return false; }
}

/** true once per `minutes` for this key (stored in app_config 'alert_state') */
async function throttle(key: string, minutes: number): Promise<boolean> {
  const d = db();
  const { data } = await d.from('app_config').select('value').eq('key', 'alert_state').maybeSingle();
  const st = (data?.value ?? {}) as Record<string, number>;
  if (st[key] && Date.now() - st[key] < minutes * 60_000) return false;
  await d.from('app_config').upsert({ key: 'alert_state', value: { ...st, [key]: Date.now() }, updated_at: new Date().toISOString() }, { onConflict: 'key' });
  return true;
}
async function clearKey(key: string) {
  const d = db();
  const { data } = await d.from('app_config').select('value').eq('key', 'alert_state').maybeSingle();
  const st = { ...((data?.value ?? {}) as Record<string, number>) };
  if (!(key in st)) return false;
  delete st[key];
  await d.from('app_config').upsert({ key: 'alert_state', value: st, updated_at: new Date().toISOString() }, { onConflict: 'key' });
  return true;
}

/**
 * Called (in the background) whenever a reception/TV screen reads the queue.
 * Alerts only when it matters: patients are still on the list but no clinic PC has sent it for > 3 min,
 * or the sending PC reports an error (e.g. wrong date). Sends «عادت المزامنة» when it recovers.
 */
let lastCheck = 0;
export async function checkSyncAlert(date: string, clinicName: string, activePatients: number) {
  if (!alertsEnabled() || Date.now() - lastCheck < 60_000) return;     // at most once a minute per server instance
  lastCheck = Date.now();
  const st = await rpc<any>('push_status', { p_date: date }).catch(() => null);
  if (!st) return;
  const src: any[] = st.sources ?? [];
  const fresh = src.filter((s) => s.seen_seconds_ago != null).sort((a, b) => a.seen_seconds_ago - b.seen_seconds_ago);
  const best = fresh[0];
  const ago = best?.seen_seconds_ago ?? 1e9;
  const owner = src.find((s) => s.name === st.owner);
  if (ago > 180 && ago < 3 * 3600 && activePatients > 0) {
    if (await throttle('sync_down', 20))
      await phoneAlert('⚠ توقفت مزامنة الدور', `${clinicName}: لم يرسل أي جهاز القائمة منذ ${Math.round(ago / 60)} دقيقة (${activePatients} مريض في القائمة).\nآخر جهاز: ${best?.label ?? '—'}. افحص الكمبيوتر والإنترنت والساعة.`, { tags: 'warning', priority: 5 });
    return;
  }
  if (owner?.error && owner.seen_seconds_ago < 180) {
    if (await throttle('sync_err', 30))
      await phoneAlert('⚠ خطأ في جهاز المزامنة', `${clinicName} – ${owner.label}: ${String(owner.error).slice(0, 200)}`, { tags: 'warning' });
    return;
  }
  if (ago <= 60 && await clearKey('sync_down')) await phoneAlert('✅ عادت المزامنة', `${clinicName}: ${best?.label ?? ''} يرسل القائمة الآن.`, { tags: 'white_check_mark', priority: 3 });
}
