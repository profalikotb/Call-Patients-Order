import { handle, json, requireStaff } from '@/lib/server/http';
import { getClinics } from '@/lib/server/settings';
import { canAccessClinic } from '@/lib/server/auth';
import { clean } from '@/lib/envClean';
import { getSession } from '@/lib/server/session';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const GET = handle(async () => {
  const s = await requireStaff();
  const clinics = (await getClinics()).filter((c) => c.active && canAccessClinic(s, c.id));
  const open = await getSession().catch(() => null);
  return json({ ok: true, clinics, session: s, demo: process.env.DEMO_MODE === '1',
    open_clinic: open?.clinic ?? null,
    display_key: s.role === 'admin' ? clean(process.env.DISPLAY_KEY) : undefined });   // TV links: admin only
});
