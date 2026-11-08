import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { startDb, stopDb } from './pg';

let pool: any;
let q: (sql: string, p?: unknown[]) => Promise<any>;
beforeAll(async () => { pool = await startDb(); q = async (s, p) => (await pool.query(s, p)).rows; }, 120000);
afterAll(async () => { await stopDb(pool); });

describe('push lease', () => {
  it('first PC owns, second refused, takes over after idle; refresh request', async () => {
    const d = '2026-11-08';
    expect((await q(`select push_claim($1,'DESK',180) r`, [d]))[0].r.ok).toBe(true);
    const r2 = (await q(`select push_claim($1,'LAP',180) r`, [d]))[0].r;
    expect(r2.ok).toBe(false); expect(r2.owner).toBe('DESK');
    expect((await q(`select push_poll($1,'DESK') r`, [d]))[0].r.want).toBe(false);
    await q(`select push_request($1)`, [d]);
    expect((await q(`select push_poll($1,'DESK') r`, [d]))[0].r.want).toBe(true);
    await q(`select push_claim($1,'DESK',180)`, [d]);
    expect((await q(`select push_poll($1,'DESK') r`, [d]))[0].r.want).toBe(false);
    await q(`update push_state set owner_seen_at = now() - interval '4 minutes'`);
    const r3 = (await q(`select push_claim($1,'LAP',180) r`, [d]))[0].r;
    expect(r3.ok).toBe(true); expect(r3.took_over).toBe(true);
    expect((await q(`select push_poll('2026-11-09','X') r`))[0].r.want).toBe(false);
  });
});
