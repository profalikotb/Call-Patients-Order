import { handle, json, requireStaff, clinicParam, HttpError } from '@/lib/server/http';
import { rpc } from '@/lib/server/db';
import { sessionDate } from '@/lib/server/session';
export const runtime = 'nodejs';

const ACTIONS = new Set(['call_next', 'call', 'repeat', 'skip', 'return_waiting', 'in_room', 'done', 'postpone', 'cancel',
  'move', 'emergency', 'set_number', 'checkin', 'add_walkin', 'pause', 'resume', 'undo']);
const UUID = /^[0-9a-f-]{36}$/i;

export const POST = handle(async (req) => {
  const b = await req.json().catch(() => null);
  if (!b) throw new HttpError(400, 'bad_json');
  const clinic = clinicParam(b.clinic);
  const s = await requireStaff({ clinic });
  if (!ACTIONS.has(b.action)) throw new HttpError(400, 'bad_action');
  if (b.entryId && !UUID.test(b.entryId)) throw new HttpError(400, 'bad_entry');
  const args = typeof b.args === 'object' && b.args ? b.args : {};
  if (b.action === 'add_walkin') {
    args.name = String(args.name ?? '').slice(0, 120);
    args.phone = String(args.phone ?? '').slice(0, 30);
    args.procedure = String(args.procedure ?? '').slice(0, 80);
  }
  const res = await rpc('queue_apply', {
    p_clinic: clinic, p_date: await sessionDate(clinic), p_action: b.action, p_entry: b.entryId ?? null,
    p_expected_version: Number.isFinite(b.expectedVersion) ? b.expectedVersion : null,
    p_actor: s.name || s.sub, p_idem: typeof b.idem === 'string' ? b.idem.slice(0, 80) : null, p_args: args,
  });
  return json(res, res?.ok ? 200 : res?.error === 'stale' ? 409 : 422);
});
