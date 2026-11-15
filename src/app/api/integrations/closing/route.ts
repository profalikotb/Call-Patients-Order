// MS Access → read the saved day closing (to copy it into the CASES table).
// GET ?clinic=heliopolis&date=2026-11-15   header X-Queue-Token
// Plain text  key=value  lines (easy to parse in VBA, UTF-8).  date omitted → the open session's date.
import { handle, HttpError, clinicParam } from '@/lib/server/http';
import { clean } from '@/lib/envClean';
import { db } from '@/lib/server/db';
import { getSession, defaultClinic } from '@/lib/server/session';
import { EXPENSES, calcClosing } from '@/lib/closing';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const txt = (s: string, status = 200) => new Response(s, { status, headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' } });

export const GET = handle(async (req) => {
  const want = clean(process.env.QUEUE_API_TOKEN);
  if (!want || clean(req.headers.get('x-queue-token')) !== want) throw new HttpError(401, 'bad_token');
  const u = new URL(req.url);
  const s = await getSession(defaultClinic());
  const cp = u.searchParams.get('clinic');
  const clinic = clinicParam(!cp || cp === 'auto' ? (s?.clinic ?? defaultClinic()) : cp);
  const date = u.searchParams.get('date') || (s && s.clinic === clinic ? String(s.date).slice(0, 10) : '');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return txt('ok=0\nerror=bad_date\n', 400);
  const { data, error } = await db().from('day_closing').select('*').eq('clinic_id', clinic).eq('service_date', date).maybeSingle();
  if (error) return txt(`ok=0\nerror=${error.message.replace(/\s+/g, ' ')}\n`, 500);
  if (!data) return txt(`ok=0\nerror=not_saved\nclinic=${clinic}\ndate=${date}\n`, 404);
  const it = data.items ?? {};
  const c = calcClosing(it, date.split('-').reverse().join('/'));
  const one = (v: unknown) => String(v ?? '').replace(/[\r\n=]+/g, ' ').trim();
  const lines = [
    'ok=1', `clinic=${clinic}`, `date=${date}`,
    `no_cases=${Number(it.no_cases) || 0}`, `fees_back=${Number(it.fees_back) || 0}`, `fees=${Number(it.fees) || 0}`,
    ...EXPENSES.map(([k]) => `${k}=${Number(it[k]) || 0}`),
    `net_number=${c.net_number}`, `net_fees=${c.net_fees}`, `grand_net=${c.grand_net}`,
    `notes_other=${one(it.notes_other)}`, `notes=${one(it.notes)}`, `report=${one(c.report)}`,
  ];
  return txt(lines.join('\n') + '\n');
});
