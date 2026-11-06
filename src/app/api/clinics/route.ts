import { handle, json, requireStaff } from '@/lib/server/http';
import { getClinics } from '@/lib/server/settings';
import { canAccessClinic } from '@/lib/server/auth';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const GET = handle(async () => {
  const s = await requireStaff();
  const clinics = (await getClinics()).filter((c) => c.active && canAccessClinic(s, c.id));
  return json({ ok: true, clinics, session: s, demo: process.env.DEMO_MODE === '1' });
});
