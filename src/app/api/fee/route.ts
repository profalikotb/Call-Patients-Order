// POST {clinic, fee}  (admin only) – كشف fee used for the payment totals
import { handle, json, requireStaff, clinicParam, HttpError } from '@/lib/server/http';
import { setFee, getFees } from '@/lib/server/fees';
export const runtime = 'nodejs';
// GET → all fees {clinic: fee} (admin)
export const GET = handle(async () => { await requireStaff({ admin: true }); return json({ ok: true, fees: await getFees() }); });
export const POST = handle(async (req) => {
  const b = await req.json().catch(() => null);
  const clinic = clinicParam(String(b?.clinic || ''));
  await requireStaff({ clinic, admin: true });
  const fee = Number(String(b?.fee ?? '').replace(/[^\d.]/g, ''));
  if (!Number.isFinite(fee) || fee < 0 || fee > 100000) throw new HttpError(400, 'bad_fee');
  await setFee(clinic, fee);
  return json({ ok: true, fee: Math.round(fee) });
});
