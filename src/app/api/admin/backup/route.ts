// GET (admin) → download a FULL backup now (all days) as a JSON file.  ?list=1 → stored daily files.
import { handle, json, requireStaff } from '@/lib/server/http';
import { makeBackup } from '@/lib/server/backup';
import { db } from '@/lib/server/db';
import { cairoDate } from '@/lib/time';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export const GET = handle(async (req) => {
  await requireStaff({ admin: true });
  if (new URL(req.url).searchParams.get('list')) {
    const { data } = await db().storage.from('backups').list('', { limit: 200, sortBy: { column: 'name', order: 'desc' } });
    return json({ ok: true, files: (data ?? []).map((f) => ({ name: f.name, size: (f.metadata as any)?.size ?? null })) });
  }
  const { data } = await makeBackup(true);
  return new Response(JSON.stringify(data), { headers: {
    'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store',
    'Content-Disposition': `attachment; filename="smart-queue-backup-${cairoDate()}.json"` } });
});
