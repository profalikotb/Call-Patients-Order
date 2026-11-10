// Fixed calling numbers from the sheet ("رقم النداء") become the queue numbers.
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import type pg from 'pg';
import { startDb, stopDb } from './pg';

let db: pg.Pool;
const D = '2026-11-06', T = 'toukh';
const row = (id: string, call_no: number | null, extra: any = {}) =>
  ({ booking_key: `id:${id}`, booking_id: id, name: id, phone: null, appt_time: null, appt_minutes: null,
     procedure: '1', cancelled: false, dup_hint: null, call_no, ...extra });
const sync = async (rows: any[]) =>
  (await db.query('select queue_sync($1,$2,$3::jsonb,true) r', [T, D, JSON.stringify(rows)])).rows[0].r;
const act = async (action: string, entry: string | null = null, args: any = {}) =>
  (await db.query('select queue_apply($1,$2,$3,$4,$5,$6,$7,$8::jsonb) r', [T, D, action, entry, null, 'test', null, JSON.stringify(args)])).rows[0].r;
const nums = async () => Object.fromEntries((await db.query(
  'select booking_id, queue_number from queue_entries where clinic_id=$1 and service_date=$2', [T, D])).rows.map((r) => [r.booking_id, r.queue_number]));
const display = async () => (await db.query('select * from display_state where clinic_id=$1', [T])).rows[0];

beforeAll(async () => { db = await startDb(); });
afterAll(async () => { await stopDb(db); });
beforeEach(async () => {
  await db.query('truncate queue_entries, queue_days, announcements, audit_log, display_state cascade');
  await db.query("update clinic_settings set policy='time' where clinic_id=$1", [T]);
});

describe('رقم النداء from the sheet', () => {
  it('uses the sheet numbers as queue numbers (gaps allowed) and calls in that order', async () => {
    await sync([row('28817', 9), row('28816', 8), row('28801', 1, { procedure: 'تم الكشف' })]);
    expect(await nums()).toEqual({ '28816': 8, '28817': 9, '28801': 1 });
    const r = await act('call_next');
    expect(r.ok).toBe(true);
    expect((await display()).current_number).toBe(1);
    await act('call_next');
    expect((await display()).current_number).toBe(8);
  });
  it('re-sync is a no-op; new booking appears with its own sheet number after the queue started', async () => {
    await sync([row('A', 8), row('B', 9)]);
    expect((await sync([row('A', 8), row('B', 9)])).changed).toBe(false);
    await act('call_next');
    await sync([row('A', 8), row('B', 9), row('C', 10)]);
    expect(await nums()).toEqual({ A: 8, B: 9, C: 10 });
  });
  it('rows without a number are numbered after the highest fixed number, never colliding', async () => {
    await sync([row('A', 3), row('B', null), row('C', 5)]);
    expect(await nums()).toEqual({ A: 3, C: 5, B: 6 });
    await sync([row('A', 3), row('B', null), row('C', 5), row('D', 6)]);   // sheet now gives 6 → B moves (not started)
    const n = await nums();
    expect(n.D).toBe(6);
    expect(n.B).toBe(7);
  });
  it('a walk-in holding the number after start keeps it; the sheet row gets the next free number', async () => {
    await sync([row('A', 1)]);
    await act('call_next');
    const w = await act('add_walkin', null, { name: 'walk-in' });
    expect(w.ok).toBe(true);
    const walkNo = (await db.query("select queue_number from queue_entries where source <> 'sheet'")).rows[0].queue_number;
    await sync([row('A', 1), row('B', walkNo)]);
    const b = (await nums()).B;
    expect(b).not.toBe(walkNo);
    const all = (await db.query('select queue_number from queue_entries where clinic_id=$1 and queue_number is not null', [T])).rows.map((r) => r.queue_number);
    expect(new Set(all).size).toBe(all.length);
  });
});

describe('رقم النداء renumbered by the sheet', () => {
  it('swaps / shifts numbers without unique-index conflicts (e.g. switching to booking-order numbering)', async () => {
    // old scheme: pending first (1..3), seen later (4..5)
    await sync([row('S1', 4, { procedure: 'تم الكشف' }), row('S2', 5), row('P1', 1), row('P2', 2), row('P3', 3)]);
    // new scheme: position by booking id
    await sync([row('S1', 1, { procedure: 'تم الكشف' }), row('S2', 2), row('P1', 3), row('P2', 4), row('P3', 5)]);
    expect(await nums()).toEqual({ S1: 1, S2: 2, P1: 3, P2: 4, P3: 5 });
  });
  it('an already-called patient keeps the number that was announced', async () => {
    await sync([row('A', 5), row('B', 6)]);
    await act('call_next');                       // A (5) called
    await sync([row('A', 1), row('B', 2)]);
    const n = await nums();
    expect(n.A).toBe(5);
    expect(n.B).toBe(2);
  });
});

describe('seen in Oracle → done in queue', () => {
  it('marks only the given bookings done and leaves the rest waiting', async () => {
    await sync([row('A', 1), row('B', 2), row('C', 3)]);
    await act('call_next');                                   // A called
    const n = (await db.query('select queue_mark_seen($1,$2,$3::text[]) n', [T, D, ['id:A', 'id:C']])).rows[0].n;
    expect(n).toBe(2);
    const st = Object.fromEntries((await db.query('select booking_id, status from queue_entries where clinic_id=$1', [T])).rows.map((r) => [r.booking_id, r.status]));
    expect(st).toEqual({ A: 'done', B: 'waiting', C: 'done' });
    expect((await db.query('select queue_mark_seen($1,$2,$3::text[]) n', [T, D, ['id:A']])).rows[0].n).toBe(0); // idempotent
  });
});

describe('sheet mirror (004)', () => {
  const mirror = async () => (await db.query('select queue_mirror_sheet($1,$2) n', [T, D])).rows[0].n;
  const st = async () => Object.fromEntries((await db.query(
    'select booking_id, status, queue_number from queue_entries where clinic_id=$1', [T])).rows.map((r) => [r.booking_id, `${r.status}:${r.queue_number}`]));
  it('bookings deleted in Oracle: numbers follow the sheet even for called patients', async () => {
    const rows = ['A', 'B', 'C', 'D', 'E'].map((id, i) => row(id, i + 1));
    await sync(rows); await mirror();
    await act('call_next'); await act('in_room');            // A in room
    await act('call_next');                                  // B called
    // Oracle: A, B, C deleted; D, E renumbered 1, 2 … and B is still there? no – only D, E remain
    await sync([row('D', 1), row('E', 2)]);
    await mirror();
    const s = await st();
    expect(s.D).toBe('waiting:1');
    expect(s.E).toBe('waiting:2');
    expect(s.A.startsWith('done')).toBe(true);
    expect(s.B.startsWith('done')).toBe(true);
    expect(s.C.startsWith('cancelled')).toBe(true);
  });
  it('a called patient whose number shifts takes the new sheet number', async () => {
    await sync([row('X', 1), row('Y', 2), row('Z', 3)]); await mirror();
    await act('call_next'); await act('call_next');          // X, Y called
    await sync([row('Y', 1), row('Z', 2)]);                  // X deleted in Oracle
    await mirror();
    const s = await st();
    expect(s.Y).toBe('called:1');
    expect(s.Z).toBe('waiting:2');
  });
  it('walk-in moves after the sheet numbers, no duplicates', async () => {
    await sync([row('P', 1)]); await mirror();
    await act('add_walkin', null, { name: 'w' });
    await sync([row('P', 1), row('Q', 2)]); await mirror();
    const nums = (await db.query('select queue_number from queue_entries where clinic_id=$1 and queue_number is not null', [T])).rows.map((r) => r.queue_number);
    expect(new Set(nums).size).toBe(nums.length);
    expect((await st()).Q).toBe('waiting:2');
  });
});
