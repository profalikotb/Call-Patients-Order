'use client';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
let c: SupabaseClient | null = null;
/** anon client – can ONLY read display_state (numbers). Used for Realtime push. */
export function sb(): SupabaseClient | null {
  if (c) return c;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL, key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) return null;
  c = createClient(url, key, { auth: { persistSession: false }, realtime: { params: { eventsPerSecond: 5 } } });
  return c;
}

/** Subscribe to one clinic's display_state row. Returns unsubscribe. onStatus reports connection health. */
export function watchDisplay(clinic: string, onChange: (row: any) => void, onStatus: (ok: boolean) => void): () => void {
  const client = sb();
  if (!client) { onStatus(false); return () => {}; }
  const ch = client.channel(`display:${clinic}:${Math.random().toString(36).slice(2, 8)}`)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'display_state', filter: `clinic_id=eq.${clinic}` },
      (p) => onChange(p.new))
    .subscribe((status) => onStatus(status === 'SUBSCRIBED'));
  return () => { client.removeChannel(ch); };
}
