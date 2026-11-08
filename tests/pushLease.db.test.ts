import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { startDb, stopDb } from './pg';

let pool: any;
let q: (sql: string, p?: unknown[]) => Promise<any>;
beforeAll(async () => { pool = await startDb(); q = async (s, p) => (await pool.query(s, p)).rows; }, 120000);
afterAll(async () => { await stopDb(pool); });
const claim = async (d: string, src: string, prio: number) => (await q(`select push_claim($1,$2,$3,null,180) r`, [d, src, prio]))[0].r;
const poll = async (d: string, src: string, prio: number, err: string | null = null) => (await q(`select push_poll($1,$2,$3,null,$4) r`, [d, src, prio, err]))[0].r;

describe('push sources: priority, take-over, manual switch', () => {
  const d = '2026-11-08';
  it('priority order and automatic hand-over', async () => {
    expect((await claim(d, 'laptop', 4)).ok).toBe(true);           // laptop first
    expect((await claim(d, 'home', 2)).why).toBe('higher_priority'); // home outranks laptop
    expect((await claim(d, 'laptop', 4)).ok).toBe(false);
    expect((await claim(d, 'clinic', 1)).why).toBe('higher_priority');
    expect((await claim(d, 'home', 2)).ok).toBe(false);
    await q(`update push_state set owner_seen_at = now() - interval '4 minutes'`);   // clinic switched off
    expect((await claim(d, 'laptop', 4)).why).toBe('owner_silent');
  });
  it('manual switch pins a lower-priority PC; refresh asks the owner only', async () => {
    await claim(d, 'clinic', 1);
    await poll(d, 'laptop', 4);
    const r = (await q(`select push_request($1,'laptop') r`, [d]))[0].r;
    expect(r.ok).toBe(true); expect(r.pinned).toBe(true);
    expect((await poll(d, 'laptop', 4)).want).toBe(true);
    expect((await poll(d, 'clinic', 1)).want).toBe(false);
    expect((await claim(d, 'clinic', 1)).ok).toBe(false);          // pinned → clinic refused
    expect((await claim(d, 'laptop', 4)).ok).toBe(true);
    expect((await poll(d, 'laptop', 4)).want).toBe(false);
    await q(`select push_request($1,null)`, [d]);
    expect((await poll(d, 'laptop', 4)).want).toBe(true);
    expect((await poll(d, 'clinic', 1)).want).toBe(false);
    await q(`update push_sources set last_seen_at = now() - interval '5 minutes' where name='home'`);
    expect((await q(`select push_request($1,'home') r`, [d]))[0].r.error).toBe('pc_offline');
    const st = (await q(`select push_status($1) r`, [d]))[0].r;
    expect(st.owner).toBe('laptop'); expect(st.sources.map((s: any) => s.name)).toEqual(['clinic', 'home', 'laptop']);
  });

  it('a chosen PC stays the source even when silent; «auto» returns to priority; errors are reported', async () => {
    const d2 = '2026-11-09';
    await claim(d2, 'home', 2); await poll(d2, 'laptop', 4);
    expect((await q(`select push_request($1,'laptop') r`, [d2]))[0].r.ok).toBe(true);
    await q(`update push_state set owner_seen_at = now() - interval '10 minutes' where service_date = $1`, [d2]);
    expect((await claim(d2, 'home', 2)).ok).toBe(false);            // no hand-back while chosen
    await poll(d2, 'laptop', 4, 'Cannot connect to Oracle');
    let st = (await q(`select push_status($1) r`, [d2]))[0].r;
    expect(st.sources.find((x: any) => x.name === 'laptop').error).toBe('Cannot connect to Oracle');
    await poll(d2, 'home', 2);
    await q(`update push_sources set last_seen_at = now() - interval '5 minutes' where name = 'clinic'`);
    const a = (await q(`select push_request($1,'auto') r`, [d2]))[0].r;
    expect(a.pinned).toBe(false);
    expect((await poll(d2, 'clinic', 1)).want).toBe(false);          // clinic offline (old heartbeat) → home chosen
    expect((await claim(d2, 'home', 2)).ok).toBe(true);
    expect((await claim(d2, 'laptop', 4)).ok).toBe(false);
    st = (await q(`select push_status($1) r`, [d2]))[0].r;
    expect(st.owner).toBe('home');
  });
});
