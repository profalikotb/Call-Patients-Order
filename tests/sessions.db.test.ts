import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { startDb, stopDb } from './pg';

let pool: any;
let q: (sql: string, p?: unknown[]) => Promise<any>;
beforeAll(async () => { pool = await startDb(); q = async (s, p) => (await pool.query(s, p)).rows; }, 120000);
afterAll(async () => { await stopDb(pool); });
const cur = async (c: string | null = 'heliopolis') => (await q(`select session_current($1, 4) r`, [c]))[0].r;
const today = async () => (await q(`select ((now() at time zone 'Africa/Cairo')::date)::text d`))[0].d;

describe('persistent clinic sessions', () => {
  it('opens one session and keeps it', async () => {
    const a = await cur();
    expect(a.clinic).toBe('heliopolis'); expect(a.date).toBe(await today()); expect(a.auto).toBe(true);
    expect((await cur('toukh')).id).toBe(a.id);                    // default clinic only used when none is open
  });
  it('midnight: an active session from yesterday stays open', async () => {
    await q(`update clinic_sessions set service_date = service_date - 1, started_at = now() - interval '3 hours' where status = 'open'`);
    const s = await cur();
    expect(s.date).not.toBe(await today());                       // still «Saturday» after midnight
  });
  it('a recent call keeps the old-day session alive; a forgotten one rolls over after 4 h idle', async () => {
    const s = await cur();
    await q(`update clinic_sessions set started_at = now() - interval '10 hours' where id = $1`, [s.id]);
    await q(`insert into audit_log (clinic_id, service_date, action, actor) values ('heliopolis', $1, 'call_next', 't')`, [s.date]);
    expect((await cur()).id).toBe(s.id);                            // call 0 min ago → still in session
    await q(`update audit_log set created_at = now() - interval '5 hours'`);
    const hour = Number((await q(`select extract(hour from now() at time zone 'Africa/Cairo')::int h`))[0].h);
    if (hour < 8) { expect((await cur()).id).toBe(s.id); return; }   // before 08:00 Cairo: never auto-closed
    const n = await cur();
    expect(n.id).not.toBe(s.id); expect(n.date).toBe(await today());
    expect((await q(`select ended_by from clinic_sessions where id = $1`, [s.id]))[0].ended_by).toMatch(/auto/);
  });
  it('manual start (any clinic, earlier date) and end', async () => {
    const s = (await q(`select session_start('toukh', '2026-11-01', 'Dr') r`))[0].r;
    expect(s.clinic).toBe('toukh'); expect(s.date).toBe('2026-11-01'); expect(s.auto).toBe(false);
    expect((await cur()).id).toBe(s.id);
    expect((await q(`select count(*)::int n from clinic_sessions where status = 'open'`))[0].n).toBe(1);
    await q(`select session_end('Dr')`);
    expect((await cur(null))).toBeNull();                           // nothing open, no default → none
    const list = (await q(`select session_list(10) r`))[0].r;
    expect(list.length).toBeGreaterThanOrEqual(3);
  });
});

describe('patient code', () => {
  it('queue_set_codes stores the Oracle code by booking id', async () => {
    await q(`insert into queue_entries (clinic_id, service_date, booking_key, booking_id, patient_name) values ('heliopolis','2026-11-09','b:28852','28852','أحمد')`);
    await q(`select queue_set_codes('heliopolis','2026-11-09','{"28852":"662282","999":"1"}'::jsonb)`);
    expect((await q(`select patient_code from queue_entries where booking_id = '28852'`))[0].patient_code).toBe('662282');
  });
});
