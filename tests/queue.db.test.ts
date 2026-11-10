// Real PostgreSQL tests for the queue state machine (the same SQL that runs on Supabase).
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import type pg from 'pg';
import { startDb, stopDb } from './pg';

let db: pg.Pool;
const D = '2026-11-05';
const H = 'heliopolis', T = 'toukh';

const row = (id: string, hhmm: string, name = id, extra: any = {}) => {
  const [h, m] = hhmm.split(':').map(Number);
  return { booking_key: `id:${id}`, booking_id: id, name, phone: null, appt_time: hhmm, appt_minutes: h * 60 + m, procedure: 'كشف', cancelled: false, dup_hint: null, ...extra };
};
async function sync(clinic: string, rows: any[], date = D) {
  return (await db.query('select queue_sync($1,$2,$3::jsonb,true) r', [clinic, date, JSON.stringify(rows)])).rows[0].r;
}
async function act(clinic: string, action: string, o: { entry?: string | null; ver?: number | null; idem?: string | null; args?: any; date?: string } = {}) {
  return (await db.query('select queue_apply($1,$2,$3,$4,$5,$6,$7,$8::jsonb) r',
    [clinic, o.date ?? D, action, o.entry ?? null, o.ver ?? null, 'test', o.idem ?? null, JSON.stringify(o.args ?? {})])).rows[0].r;
}
const entries = async (clinic = H, date = D) =>
  (await db.query('select * from queue_entries where clinic_id=$1 and service_date=$2 order by queue_number nulls last, booking_key', [clinic, date])).rows;
const byId = async (bid: string, clinic = H) => (await entries(clinic)).find((e) => e.booking_id === bid);
const display = async (clinic = H) => (await db.query('select * from display_state where clinic_id=$1', [clinic])).rows[0];
const version = async (clinic = H) => Number((await db.query('select version from queue_days where clinic_id=$1 and service_date=$2', [clinic, D])).rows[0]?.version ?? 0);
const policy = (clinic: string, p: string) => db.query('update clinic_settings set policy=$2 where clinic_id=$1', [clinic, p]);

const FIVE = [row('A', '18:00'), row('B', '18:10'), row('C', '18:20'), row('D', '18:30'), row('E', '18:40')];

beforeAll(async () => { db = await startDb(); });
afterAll(async () => { await stopDb(db); });
beforeEach(async () => {
  await db.query('truncate queue_entries, queue_days, announcements, audit_log, display_state cascade');
  await policy(H, 'time'); await policy(T, 'time');
});

describe('Sheet synchronisation', () => {
  it('assigns numbers by appointment time, not by sheet row order', async () => {
    await sync(H, [FIVE[3], FIVE[0], FIVE[4], FIVE[1], FIVE[2]]);
    expect((await entries()).map((e) => [e.booking_id, e.queue_number])).toEqual([['A', 1], ['B', 2], ['C', 3], ['D', 4], ['E', 5]]);
  });
  it('re-sorting / re-syncing the sheet never duplicates or renumbers', async () => {
    await sync(H, FIVE);
    for (let i = 0; i < 5; i++) await sync(H, [...FIVE].sort(() => Math.random() - 0.5));
    const e = await entries();
    expect(e).toHaveLength(5);
    expect(e.map((x) => x.queue_number)).toEqual([1, 2, 3, 4, 5]);
    const r = await sync(H, FIVE);
    expect(r.changed).toBe(false);
  });
  it('before first call a late earlier-slot booking re-sorts numbers; after first call numbers are frozen', async () => {
    await sync(H, FIVE.slice(1));
    await sync(H, FIVE); // A (18:00) arrives late in the sheet, queue not started → renumber
    expect((await byId('A'))!.queue_number).toBe(1);
    await act(H, 'call_next');
    await sync(H, [...FIVE, row('Z', '17:00')]); // earlier slot but queue already started → appended
    expect((await byId('Z'))!.queue_number).toBe(6);
    expect((await entries()).filter((e) => e.booking_id !== 'Z').map((e) => e.queue_number)).toEqual([1, 2, 3, 4, 5]);
  });
  it('cancel in sheet → cancelled; row deleted from sheet → cancelled; reappears → restored', async () => {
    await sync(H, FIVE);
    await sync(H, [FIVE[0], { ...FIVE[1], cancelled: true }, FIVE[2], FIVE[3], FIVE[4]]);
    expect((await byId('B'))!.status).toBe('cancelled');
    await sync(H, [FIVE[0], FIVE[1], FIVE[2], FIVE[3]]); // E deleted, B un-cancelled
    expect((await byId('E'))!.status).toBe('cancelled');
    expect((await byId('B'))!.status).toBe('waiting');
    await sync(H, FIVE);
    expect((await byId('E'))!.status).toBe('waiting');
  });
  it('a sheet change never overrides a patient already called / seen', async () => {
    await sync(H, FIVE);
    await act(H, 'call_next'); // A
    await sync(H, [{ ...FIVE[0], cancelled: true }, ...FIVE.slice(1)]);
    await sync(H, FIVE.slice(1));
    expect((await byId('A'))!.status).toBe('called');
  });
  it('empty sheet read (wrong tab / API glitch) does not mass-cancel the day', async () => {
    await sync(H, FIVE);
    const r = await sync(H, []);
    expect(r.empty_guard).toBe(true);
    expect((await entries()).every((e) => e.status === 'waiting')).toBe(true);
  });
  it('old appointments never leak into today', async () => {
    await sync(H, FIVE, '2026-11-04');
    await sync(H, FIVE.slice(0, 2));
    expect(await entries()).toHaveLength(2);
    expect((await db.query("select service_date::text d from display_state where clinic_id=$1", [H])).rows[0].d).toBe(D);
  });
});

describe('Calling', () => {
  beforeEach(async () => { await sync(H, FIVE); });

  it('call next → status called (NOT seen), display + announcement updated', async () => {
    const r = await act(H, 'call_next');
    expect(r).toMatchObject({ ok: true, number: 1, announce_seq: 1 });
    const a = await byId('A');
    expect(a.status).toBe('called');
    expect(a.done_at).toBeNull();
    const d = await display();
    expect(d.current_number).toBe(1);
    expect(d.next_numbers).toEqual([2, 3, 4]);
    expect(d.announce).toMatchObject({ seq: 1, kind: 'call', number: 1, silent: false });
    expect((await db.query('select count(*)::int c from announcements')).rows[0].c).toBe(1);
  });
  it('double click from the same screen (same version) → only one call', async () => {
    const v = await version();
    const [x, y] = await Promise.all([act(H, 'call_next', { ver: v }), act(H, 'call_next', { ver: v })]);
    expect([x.ok, y.ok].sort()).toEqual([false, true]);
    expect([x.error, y.error]).toContain('stale');
    expect((await entries()).filter((e) => e.status === 'called')).toHaveLength(1);
  });
  it('retried request with the same idempotency key is applied once', async () => {
    const a = await act(H, 'call_next', { idem: 'k-1' });
    const b = await act(H, 'call_next', { idem: 'k-1' });
    expect(b).toMatchObject({ ok: true, number: a.number, idempotent: true });
    expect((await entries()).filter((e) => e.status === 'called')).toHaveLength(1);
  });
  it('10 devices hammering call next concurrently → each patient called at most once', async () => {
    const res = await Promise.all(Array.from({ length: 10 }, (_, i) => act(H, 'call_next', { idem: `p-${i}` })));
    const called = res.filter((r) => r.ok).map((r) => r.number).sort();
    expect(called).toEqual([1, 2, 3, 4, 5]);
    expect(res.filter((r) => !r.ok).every((r) => r.error === 'empty')).toBe(true);
    expect(new Set(called).size).toBe(called.length);
  });
  it('repeat re-announces the same number and is throttled', async () => {
    await act(H, 'call_next');
    await db.query("update queue_days set last_announce_at = now() - interval '10 seconds'");
    const r = await act(H, 'repeat');
    expect(r).toMatchObject({ ok: true, number: 1, announce_seq: 2 });
    expect((await act(H, 'repeat')).error).toBe('too_soon');
    expect((await display()).announce.kind).toBe('repeat');
  });
  it('full consult flow: called → in room → done (only by explicit action)', async () => {
    await act(H, 'call_next');
    await act(H, 'call_next'); // calling B does not complete A
    expect((await byId('A')).status).toBe('called');
    const a = await byId('A');
    await act(H, 'in_room', { entry: a.id });
    expect((await byId('A')).status).toBe('in_room');
    await act(H, 'done');
    const done = await byId('A');
    expect(done.status).toBe('done');
    expect(done.in_room_at).not.toBeNull();
  });
  it('skip absent → return to original place or as next', async () => {
    await act(H, 'call_next');              // A
    await act(H, 'skip');                    // A absent
    expect((await byId('A')).status).toBe('absent');
    expect((await display()).current_number).toBeNull();
    await act(H, 'call_next');               // B
    const a = await byId('A');
    await act(H, 'return_waiting', { entry: a.id, args: { position: 'next' } });
    expect((await act(H, 'call_next')).number).toBe(1);
  });
  it('recall a previously called patient announces as recall', async () => {
    await act(H, 'call_next'); await act(H, 'call_next');
    const a = await byId('A');
    const r = await act(H, 'call', { entry: a.id });
    expect(r.ok).toBe(true);
    expect((await display()).announce).toMatchObject({ kind: 'recall', number: 1 });
    expect((await byId('A')).called_count).toBe(2);
  });
  it('emergency override jumps the queue; move up/down reorders', async () => {
    const d = await byId('D');
    await act(H, 'emergency', { entry: d.id });
    expect((await display()).next_numbers[0]).toBe(4);
    const c = await byId('C');
    await act(H, 'move', { entry: c.id, args: { dir: 'up' } });  // C ahead of B
    expect((await display()).next_numbers).toEqual([4, 1, 3]);
    await act(H, 'call_next');
    expect((await byId('D')).status).toBe('called');
    expect((await byId('D')).priority).toBe(true);
  });
  it('undo restores the previous state without re-announcing', async () => {
    await act(H, 'call_next'); // A
    await act(H, 'call_next'); // B
    const u = await act(H, 'undo');
    expect(u).toMatchObject({ ok: true, undone_action: 'call_next' });
    expect((await byId('B')).status).toBe('waiting');
    expect((await byId('B')).called_count).toBe(0);
    const d = await display();
    expect(d.current_number).toBe(1);
    expect(d.announce.seq).toBe(2); // no new announcement emitted by undo
    expect((await act(H, 'call_next')).number).toBe(2);
  });
  it('pause → numbers still update but the announcement is silent', async () => {
    await act(H, 'pause');
    await act(H, 'call_next');
    expect((await display()).announce.silent).toBe(true);
    await act(H, 'resume');
    await act(H, 'call_next');
    expect((await display()).announce.silent).toBe(false);
  });
  it('walk-in gets the next number; undo removes it', async () => {
    const r = await act(H, 'add_walkin', { args: { name: 'مريض بدون حجز', phone: '0100' } });
    expect(r.number).toBe(6);
    await act(H, 'undo');
    expect(await entries()).toHaveLength(5);
  });
  it('invalid transitions are rejected', async () => {
    const a = await byId('A');
    expect((await act(H, 'done', { entry: a.id })).error).toBe('invalid_state');
    expect((await act(H, 'repeat')).error).toBe('no_target');
  });
});

describe('Policies', () => {
  it('check-in order: booked until arrival, numbers by arrival', async () => {
    await policy(H, 'checkin');
    await sync(H, FIVE);
    expect((await entries()).every((e) => e.status === 'booked' && e.queue_number === null)).toBe(true);
    expect((await act(H, 'call_next')).error).toBe('empty');
    await act(H, 'checkin', { entry: (await byId('D')).id });
    await act(H, 'checkin', { entry: (await byId('A')).id });
    expect((await byId('D')).queue_number).toBe(1);
    expect((await byId('A')).queue_number).toBe(2);
    expect((await act(H, 'call_next')).number).toBe(1);
  });
  it('manual numbers: unique per clinic-day', async () => {
    await policy(H, 'manual');
    await sync(H, FIVE);
    const a = await byId('A'), b = await byId('B');
    expect((await act(H, 'set_number', { entry: a.id, args: { number: 7 } })).ok).toBe(true);
    expect((await act(H, 'set_number', { entry: b.id, args: { number: 7 } })).error).toBe('number_taken');
    expect((await act(H, 'call_next')).number).toBe(7);
  });
});

describe('Multiple clinics & devices', () => {
  it('clinics are fully isolated', async () => {
    await sync(H, FIVE);
    await sync(T, [row('T1', '14:00'), row('T2', '14:10')]);
    await act(T, 'call_next');
    expect((await display(T)).current_number).toBe(1);
    expect((await display(H)).current_number).toBeNull();
    expect((await entries(H)).every((e) => e.status === 'waiting')).toBe(true);
    // an entry id from one clinic cannot be acted on from the other
    expect((await act(T, 'skip', { entry: (await byId('A')).id })).error).toBe('not_found');
  });
  it('single audio device lease: claim, refuse second, force takeover, expiry', async () => {
    const claim = async (dev: string, force = false, secs = 60) =>
      (await db.query('select display_claim($1,$2,$3,$4,$5) r', [H, dev, dev, force, secs])).rows[0].r;
    expect((await claim('tv-1')).ok).toBe(true);
    expect((await claim('tv-1')).ok).toBe(true);      // heartbeat
    const b = await claim('tablet-2');
    expect(b).toMatchObject({ ok: false, holder: 'tv-1' });
    expect((await claim('tablet-2', true)).ok).toBe(true);
    expect((await claim('tv-1')).ok).toBe(false);     // old holder must stop speaking
    await db.query("update display_state set audio_lease_until = now() - interval '1 second'");
    expect((await claim('tv-1')).ok).toBe(true);      // expired lease → free
  });
});

describe('Database security (Supabase roles)', () => {
  it('anon can read the numbers-only projection but nothing else', async () => {
    await sync(H, FIVE);
    const c = await db.connect();
    try {
      await c.query('set role anon');
      expect((await c.query('select current_number from display_state')).rowCount).toBeGreaterThan(0);
      await expect(c.query('select * from queue_entries')).rejects.toThrow(/permission denied/);
      await expect(c.query("select queue_apply('heliopolis','2026-11-05','call_next')")).rejects.toThrow(/permission denied/);
      await expect(c.query('select * from staff')).rejects.toThrow(/permission denied/);
    } finally { await c.query('reset role'); c.release(); }
  });
  it('display projection contains no patient-identifying columns', async () => {
    const cols = (await db.query("select column_name from information_schema.columns where table_name='display_state'")).rows.map((r) => r.column_name);
    expect(cols.some((c) => /name|phone|booking/.test(c) && c !== 'audio_device_label')).toBe(false);
  });
});
