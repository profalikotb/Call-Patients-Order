import { handle, json, requireStaff } from '@/lib/server/http';
import { syncAll } from '@/lib/server/sync';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const POST = handle(async (req) => {
  await requireStaff();
  const { force } = await req.json().catch(() => ({}));
  return json(await syncAll(!!force));
});
