// Machine-to-machine queue control (MS Access / VBA, n8n, Stream Deck …).
// Auth: header  X-Queue-Token: <QUEUE_API_TOKEN>   (no browser session needed)
//
// POST /api/integrations/call
//   { "clinic": "toukh" | "heliopolis" | "auto",          // auto = by weekday (Fri → toukh, else heliopolis)
//     "action": "call_next" | "call" | "repeat" | "in_room" | "done" | "skip",
//     "booking_id": "28816" }                             // only for action "call" (calls THAT patient)
// → { ok, number, name, clinic, action }  or  { ok:false, error }
import { timingSafeEqual } from 'node:crypto';
import { handle, json, HttpError, clinicParam } from '@/lib/server/http';
import { db, rpc } from '@/lib/server/db';
import { syncAll } from '@/lib/server/sync';
import { cairoDate } from '@/lib/time';
import { clean } from '@/lib/envClean';
import { sheetSource } from '@/lib/server/sheets';
import { clientIp, pcForCaller, pushOwner, requestPushAndWait } from '@/lib/server/pushSource';
export const runtime = 'nodejs';
export const maxDuration = 30;
export const dynamic = 'force-dynamic';

const ALLOWED = new Set(['call_next', 'call', 'repeat', 'in_room', 'done', 'skip']);

function checkToken(req: Request) {
  const want = clean(process.env.QUEUE_API_TOKEN);
  if (!want || want.length < 16) throw new HttpError(500, 'QUEUE_API_TOKEN not configured (16+ characters)');
  const got = Buffer.from(clean(req.headers.get('x-queue-token'))), exp = Buffer.from(want);
  if (got.length !== exp.length || !timingSafeEqual(got, exp)) throw new HttpError(401, 'bad_token');
}

function autoClinic(): string {
  const day = new Intl.DateTimeFormat('en-US', { timeZone: 'Africa/Cairo', weekday: 'short' }).format(new Date());
  return day === 'Fri' ? 'toukh' : 'heliopolis';
}

async function findEntry(clinic: string, date: string, bookingId: string) {
  const { data } = await db().from('queue_entries').select('id, queue_number, patient_name, status')
    .eq('clinic_id', clinic).eq('service_date', date).eq('booking_id', bookingId).neq('status', 'cancelled')
    .order('created_at', { ascending: false }).limit(1);
  return data?.[0] ?? null;
}

export const POST = handle(async (req) => {
  checkToken(req);
  const b = await req.json().catch(() => null);
  if (!b) throw new HttpError(400, 'bad_json');
  const clinic = clinicParam(!b.clinic || b.clinic === 'auto' ? autoClinic() : String(b.clinic));
  const action = String(b.action || 'call_next');
  if (!ALLOWED.has(action)) throw new HttpError(400, 'bad_action');
  const date = cairoDate();
  const push = sheetSource() === 'push';

  // Desktop push: the button was pressed on a PC → THAT PC's Oracle list is used (switch + wait for it once)
  let pushNote: string | undefined;
  if (push && (action === 'call_next' || action === 'call')) {
    const host = clean(b.host) || (String(b.actor || '').match(/@([^\s]+)$/)?.[1] ?? '');
    const me = host ? await pcForCaller(host, clientIp(req)) : null;
    if (me && (await pushOwner(date)).owner !== me) {
      const w = await requestPushAndWait(date, me);
      if (!w.ok) pushNote = w.error;
    }
  }
  // list missing a patient / nobody waiting → ask the sending PC for a fresh list once, then retry
  const refresh = async () => { if (push) { const w = await requestPushAndWait(date, null); if (!w.ok) pushNote = w.error; } else await syncAll(true); };

  let entryId: string | null = null;
  if (action === 'call') {
    const bid = String(b.booking_id ?? '').replace(/[^0-9A-Za-z-]/g, '');
    if (!bid) throw new HttpError(400, 'booking_id_required');
    let e = await findEntry(clinic, date, bid);
    if (!e) { await refresh(); e = await findEntry(clinic, date, bid); }   // just booked → fresh list once
    if (!e) return json({ ok: false, error: 'booking_not_in_queue', clinic, date, push_note: pushNote,
      detail: `booking ${bid} is not in today's ${clinic} list` }, 404);
    entryId = e.id;
  }

  const apply = () => rpc('queue_apply', {
    p_clinic: clinic, p_date: date, p_action: action, p_entry: entryId,
    p_expected_version: null, p_actor: clean(b.actor) || 'MS Access', p_idem: null, p_args: {},
  });
  let res: any = await apply();
  // Queue only fills from the sheet while a reception page is open. Called from Access with no page open
  // (e.g. first call of the day) → pull the sheet once and try again.
  if (!res?.ok && res?.error === 'empty' && action === 'call_next') {
    await refresh();
    res = await apply();
  }
  if (!res?.ok) {
    const { data: rows } = await db().from('queue_entries').select('status')
      .eq('clinic_id', clinic).eq('service_date', date);
    const by: Record<string, number> = {};
    (rows ?? []).forEach((r: any) => { by[r.status] = (by[r.status] ?? 0) + 1; });
    const o = push ? await pushOwner(date) : null;
    return json({ ok: false, clinic, date, action, error: res?.error ?? 'failed', detail: res?.detail,
      entries_today: rows?.length ?? 0, by_status: Object.entries(by).map(([k, v]) => `${k} ${v}`).join(', '),
      source_pc: o?.owner ?? null, push_note: pushNote }, 422);
  }

  // report what the screen now shows
  const { data: d } = await db().from('display_state').select('current_number').eq('clinic_id', clinic).maybeSingle();
  let name: string | null = null;
  if (d?.current_number != null) {
    const { data: cur } = await db().from('queue_entries').select('patient_name')
      .eq('clinic_id', clinic).eq('service_date', date).eq('queue_number', d.current_number).limit(1);
    name = cur?.[0]?.patient_name ?? null;
  }
  return json({ ok: true, clinic, action, number: d?.current_number ?? null, name });
});
