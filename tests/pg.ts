// Spins up a real PostgreSQL (embedded binary) or uses TEST_DATABASE_URL, applies the migration.
import { readFileSync, mkdtempSync, chmodSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import pg from 'pg';

let embedded: any = null;
export async function startDb(): Promise<pg.Pool> {
  let url = process.env.TEST_DATABASE_URL;
  if (!url) {
    // optional dev-only package (npm run test:local installs it); kept out of the production install
    const mod = 'embedded-postgres';
    const { default: EmbeddedPostgres } = await import(/* @vite-ignore */ mod);
    const dir = mkdtempSync(join(tmpdir(), 'queue-pg-'));
    chmodSync(dir, 0o777);
    const port = 55000 + Math.floor(Math.random() * 2000);
    embedded = new EmbeddedPostgres({
      databaseDir: join(dir, 'data'), user: 'postgres', password: 'pw', port, persistent: false,
      initdbFlags: ['--encoding=UTF8', '--locale=C.UTF-8'], onLog: () => {}, onError: () => {},
    });
    await embedded.initialise();
    await embedded.start();
    url = `postgres://postgres:pw@localhost:${port}/postgres`;
  }
  const pool = new pg.Pool({ connectionString: url, max: 20 });
  await pool.query(`do $$ begin
    if not exists (select 1 from pg_roles where rolname='anon') then create role anon nologin; end if;
    if not exists (select 1 from pg_roles where rolname='authenticated') then create role authenticated nologin; end if;
  end $$;`);
  for (const f of ['001_queue.sql', '002_sheet_call_numbers.sql'])
    await pool.query(readFileSync(join(__dirname, '..', 'supabase', 'migrations', f), 'utf8'));
  return pool;
}
export async function stopDb(pool: pg.Pool) {
  await pool.end();
  if (embedded) await embedded.stop();
}
