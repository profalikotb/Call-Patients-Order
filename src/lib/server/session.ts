// Persistent clinic session (migration 009): the active list = open session's clinic + clinic date,
// independent of midnight and of any PC clock. Falls back to the Cairo calendar date before 009 is run.
import { rpc } from './db';
import { cairoDate } from '@/lib/time';

export interface Session {
  id: string; clinic: string; date: string; status: 'open' | 'closed';
  started_at: string; started_by: string | null; ended_at: string | null; ended_by: string | null;
  auto: boolean; clinic_name?: string;
}

/** clinic to open automatically when no session is open: Toukh PC or Friday → Toukh, else Heliopolis */
export function defaultClinic(source?: string | null): string {
  const day = new Intl.DateTimeFormat('en-US', { timeZone: 'Africa/Cairo', weekday: 'short' }).format(new Date());
  return source === 'toukh' || day === 'Fri' ? 'toukh' : 'heliopolis';
}

export async function getSession(defClinic: string | null = defaultClinic()): Promise<Session | null> {
  try {
    return (await rpc<Session | null>('session_current', { p_default_clinic: defClinic, p_idle_hours: 4 })) ?? null;
  } catch (e: any) {
    if (/session_current/.test(String(e?.message))) return null;   // 009 not run yet
    throw e;
  }
}

/** the clinic date whose list a clinic shows: the open session's date if that clinic is in session, else today */
export async function sessionDate(clinic: string): Promise<string> {
  const s = await getSession();
  return s && s.clinic === clinic ? String(s.date).slice(0, 10) : cairoDate();
}
