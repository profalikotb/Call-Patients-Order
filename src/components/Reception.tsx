'use client';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useLang } from '@/lib/i18n';
import { watchDisplay } from '@/lib/supabaseBrowser';
import { STATUS_AR, STATUS_EN, type Status } from '@/lib/config';
import { toArabicDigits, normalizeAr, toWesternDigits } from '@/lib/arabic';
import { fmtTime12, fmtTs12, fmtDate } from '@/lib/time';

type Entry = any;
const STATUS_STYLE: Record<Status, string> = {
  booked: 'bg-slate-100 text-slate-600', waiting: 'bg-sky-50 text-sky-700 ring-1 ring-sky-200',
  called: 'bg-amber-50 text-amber-800 ring-1 ring-amber-300', in_room: 'bg-violet-50 text-violet-700 ring-1 ring-violet-200',
  done: 'bg-emerald-50 text-emerald-700', absent: 'bg-rose-50 text-rose-700', postponed: 'bg-orange-50 text-orange-700',
  cancelled: 'bg-slate-100 text-slate-400 line-through',
};
const ERR_AR: Record<string, string> = {
  stale: 'تم تعديل الدور من جهاز آخر – تم تحديث القائمة، أعد المحاولة',
  empty: 'لا يوجد مرضى منتظرون', too_soon: 'انتظر ثوانٍ قبل إعادة النداء', no_target: 'لا يوجد مريض محدد',
  invalid_state: 'لا يمكن تنفيذ هذا الإجراء على حالة المريض الحالية', number_taken: 'هذا الرقم مستخدم بالفعل',
  no_number: 'المريض ليس له رقم دور – عيّن رقماً أولاً', nothing_to_undo: 'لا يوجد إجراء للتراجع عنه',
  edge: 'المريض في طرف القائمة بالفعل', bad_number: 'رقم غير صالح', unauthorized: 'انتهت الجلسة – سجّل الدخول مجدداً',
};
const ACTION_AR: Record<string, string> = {
  call_next: 'نداء التالي', call: 'نداء', repeat: 'إعادة النداء', skip: 'تخطي (غائب)', return_waiting: 'إرجاع للانتظار',
  in_room: 'دخول الكشف', done: 'إنهاء الكشف', postpone: 'تأجيل', cancel: 'إلغاء', move: 'تحريك', emergency: 'أولوية طارئة',
  set_number: 'تعيين رقم', checkin: 'تسجيل وصول', add_walkin: 'إضافة مريض', pause: 'إيقاف النداء', resume: 'استئناف النداء',
};

function uid() { return (crypto as any).randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`; }

export default function Reception({ clinic }: { clinic: string }) {
  const { t, lang, toggle } = useLang();
  const ar = lang === 'ar';
  const N = (v: any) => (v === null || v === undefined || v === '' ? '—' : ar ? toArabicDigits(v) : String(v));
  const [data, setData] = useState<any>(null);
  const [loadErr, setLoadErr] = useState('');
  const [sync, setSync] = useState<{ ok: boolean; at: number; error?: string } | null>(null);
  const [live, setLive] = useState(false);
  const [online, setOnline] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [toast, setToast] = useState<{ msg: string; kind: 'ok' | 'err'; undo?: boolean } | null>(null);
  const [filter, setFilter] = useState<'active' | 'all' | Status>('active');
  const [q, setQ] = useState('');
  const [menu, setMenu] = useState<string | null>(null);
  const [dialog, setDialog] = useState<null | { type: 'walkin' } | { type: 'number'; entry: Entry } | { type: 'confirm'; text: string; run: () => void }>(null);
  const cooldown = useRef(0);
  const toastTimer = useRef<any>(null);

  const load = useCallback(async () => {
    try {
      const r = await fetch(`/api/queue?clinic=${clinic}`, { cache: 'no-store' });
      if (r.status === 401) { location.href = `/login?next=/reception/${clinic}`; return; }
      const j = await r.json();
      if (!j.ok) throw new Error(j.error);
      setData(j); setLoadErr('');
    } catch (e: any) { setLoadErr(String(e?.message || e)); }
  }, [clinic]);

  const doSync = useCallback(async (force = false) => {
    try {
      const r = await fetch('/api/sync', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ force }) });
      const j = await r.json();
      if (!j.skipped && !j.requested) setSync({ ok: !!j.ok, at: Date.now(), error: j.error });
      return j;
    } catch (e: any) { setSync({ ok: false, at: Date.now(), error: String(e?.message || e) }); return null; }
  }, []);

  // initial + 10 s sheet sync loop (server throttles across devices)
  useEffect(() => {
    let alive = true;
    (async () => { await doSync(true); await load(); })();
    const id = setInterval(async () => { if (!alive || document.hidden) return; await doSync(false); await load(); }, 10000);
    return () => { alive = false; clearInterval(id); };
  }, [doSync, load]);

  // realtime nudge from any device's action
  useEffect(() => {
    let tmr: any;
    const off = watchDisplay(clinic, () => { clearTimeout(tmr); tmr = setTimeout(load, 120); }, setLive);
    return () => { off(); clearTimeout(tmr); };
  }, [clinic, load]);

  useEffect(() => {
    const on = () => { setOnline(true); load(); }, offl = () => setOnline(false);
    setOnline(navigator.onLine);
    window.addEventListener('online', on); window.addEventListener('offline', offl);
    const vis = () => { if (!document.hidden) load(); };
    document.addEventListener('visibilitychange', vis);
    return () => { window.removeEventListener('online', on); window.removeEventListener('offline', offl); document.removeEventListener('visibilitychange', vis); };
  }, [load]);

  const flash = (msg: string, kind: 'ok' | 'err' = 'ok', undo = false) => {
    setToast({ msg, kind, undo }); clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), undo ? 7000 : 4000);
  };

  const act = useCallback(async (action: string, entryId?: string | null, args: any = {}, versioned = false) => {
    if (busy) return;
    if (action === 'call_next') { if (Date.now() < cooldown.current) return; cooldown.current = Date.now() + 1500; }
    setBusy(action + (entryId ?? '')); setMenu(null);
    try {
      const r = await fetch('/api/queue/action', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ clinic, action, entryId: entryId ?? null, args, idem: uid(),
          expectedVersion: versioned ? data?.day?.version ?? 0 : undefined }),
      });
      const j = await r.json().catch(() => ({ ok: false, error: 'network' }));
      if (j.ok) {
        const label = action === 'undo' ? `تم التراجع عن: ${ACTION_AR[j.undone_action] ?? ''}` :
          `${ACTION_AR[action]}${j.number ? ` – رقم ${toArabicDigits(j.number)}` : ''}`;
        flash(ar ? label : `${action} ✓`, 'ok', action !== 'undo' && action !== 'repeat');
      } else flash(ERR_AR[j.error] ?? `خطأ: ${j.error}`, 'err');
    } catch { flash('تعذر الاتصال بالخادم', 'err'); }
    finally { setBusy(null); load(); }
  }, [busy, clinic, data, load, ar]);

  // keyboard: F8 call next · F7 repeat (ignored while typing)
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.tagName === 'INPUT') return;
      if (e.key === 'F8') { e.preventDefault(); act('call_next', null, {}, true); }
      if (e.key === 'F7') { e.preventDefault(); act('repeat'); }
    };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [act]);

  const entries: Entry[] = data?.entries ?? [];
  const current = entries.find((e) => e.id === data?.day?.current_entry_id) ?? null;
  const inRoom = entries.filter((e) => e.status === 'in_room');
  const shown = useMemo(() => {
    const nq = normalizeAr(q), dq = toWesternDigits(q).replace(/\D/g, '');
    return entries.filter((e) => {
      if (filter === 'active' && ['done', 'cancelled'].includes(e.status)) return false;
      if (filter !== 'active' && filter !== 'all' && e.status !== filter) return false;
      if (!q) return true;
      return normalizeAr(e.patient_name).includes(nq) || (e.booking_id && normalizeAr(e.booking_id).includes(nq)) ||
        (dq.length >= 2 && ((e.phone ?? '').includes(dq) || String(e.queue_number ?? '') === dq));
    });
  }, [entries, filter, q]);

  if (!data) return <div className="grid min-h-dvh place-items-center text-slate-500">{loadErr || '…'}</div>;
  const s = data.stats;
  const SL = ar ? STATUS_AR : STATUS_EN;
  const syncOk = sync?.ok ?? !data.day?.last_sync_error;
  const lastOk = data.day?.last_sync_ok_at;
  const canCall = s.waiting > 0;

  return (
    <div className="min-h-dvh pb-24">
      {/* header */}
      <header className="sticky top-0 z-30 bg-ink-900 text-white shadow">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center gap-x-4 gap-y-2 px-3 py-2.5 sm:px-5">
          <Link href="/" className="font-display text-lg font-extrabold">{ar ? data.clinic.name_ar : data.clinic.name_en}</Link>
          <span className="text-xs text-white/60 num">{fmtDate(data.today, ar)}</span>
          <div className="ms-auto flex flex-wrap items-center gap-1.5 text-[11px]">
            <span className={`chip ${syncOk ? 'bg-emerald-500/20 text-emerald-200' : 'bg-rose-500/30 text-rose-100'}`} title={sync?.error || data.day?.last_sync_error || ''}>
              ● {t('sheet')} {lastOk ? `· ${fmtTs12(lastOk, lang)}` : ''} {data.sheet_source !== 'google' ? `(${data.sheet_source})` : ''}
            </span>
            <span className={`chip ${live && online ? 'bg-emerald-500/20 text-emerald-200' : 'bg-amber-500/30 text-amber-100'}`}>● {online ? t('live') : t('offline')}</span>
            <span className={`chip ${data.display?.audio_ready ? 'bg-emerald-500/20 text-emerald-200' : 'bg-rose-500/30 text-rose-100'}`}
              title={data.display?.audio_device_label ?? ''}>🔊 {data.display?.audio_ready ? t('audioReady') : t('audioOff')}</span>
            <button onClick={toggle} className="chip bg-white/10">{ar ? 'EN' : 'ع'}</button>
          </div>
        </div>
        {data.day?.paused && <div className="bg-amber-500 py-1 text-center text-xs font-bold text-ink-950">{t('paused')}</div>}
        {data.sheet_source === 'demo' && <div className="bg-amber-100 py-0.5 text-center text-[11px] text-amber-900">{t('demo')}</div>}
        {!syncOk && (sync?.error || data.day?.last_sync_error) && (
          <div className="bg-rose-600/90 px-3 py-1.5 text-center text-xs text-white" dir="auto">
            ⚠ {ar ? 'تعذّر قراءة الشيت: ' : 'Sheet read failed: '}{sync?.error || data.day?.last_sync_error}
            {ar ? ' — افتح /api/health للتشخيص' : ' — open /api/health'}
          </div>
        )}
      </header>

      <main className="mx-auto max-w-7xl space-y-4 px-3 pt-4 sm:px-5">
        {/* stats + current */}
        <section className="grid gap-3 lg:grid-cols-[1.3fr_2fr]">
          <div className="card relative overflow-hidden bg-gradient-to-br from-ink-900 to-ink-700 p-5 text-white ring-0">
            <div className="text-xs font-semibold text-gold-300">{t('current')}</div>
            <div className="flex items-end gap-4">
              <div key={current?.id} className="num animate-pop text-7xl font-black leading-none text-gold-400 sm:text-8xl">{N(current?.queue_number)}</div>
              <div className="pb-2 text-sm">
                {current ? (<>
                  <div className="font-bold">{current.patient_name}</div>
                  <div className="text-white/60">{fmtTime12(current.appt_time, lang)} · {SL[current.status as Status]}{current.called_count > 1 ? ` · ×${N(current.called_count)}` : ''}</div>
                </>) : <div className="text-white/50">{t('noCurrent')}</div>}
              </div>
            </div>
            {inRoom.length > 0 && <div className="mt-3 text-xs text-violet-200">{t('inRoom')}: {inRoom.map((e) => N(e.queue_number)).join('، ')}</div>}
          </div>
          <div className="grid grid-cols-4 gap-2 sm:grid-cols-5 sm:gap-3">
            {[[t('next'), N(data.next_number), 'text-ink-800'], [t('waiting'), N(s.waiting), 'text-sky-700'], [t('done'), N(s.done), 'text-emerald-700'],
              [t('absent'), N(s.absent), 'text-rose-700'], [`${t('avg')} (${t('estimate')})`, `${N(Math.round(s.avg_consult_min))} ${t('min')}`, 'text-violet-700']]
              .map(([k, v, c], i) => (
                <div key={k} className={`card flex flex-col justify-center gap-1 p-2.5 sm:p-3 ${i === 4 ? 'col-span-4 flex-row items-center justify-between sm:col-span-1 sm:flex-col sm:items-start sm:justify-center' : ''}`}>
                  <div className="text-[10px] font-semibold text-slate-500 sm:text-[11px]">{k}</div>
                  <div className={`num text-2xl font-extrabold sm:text-3xl ${c}`}>{v}</div>
                </div>))}
          </div>
        </section>

        {/* primary controls */}
        <section className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-6">
          <button className="btn-gold col-span-2 py-5 text-lg sm:col-span-3 lg:col-span-2" disabled={!canCall || !!busy}
            onClick={() => act('call_next', null, {}, true)}>📢 {t('callNext')} <kbd className="hidden rounded bg-ink-950/10 px-1.5 text-[10px] lg:inline">F8</kbd></button>
          <button className="btn-primary py-4" disabled={!current || !['called', 'in_room'].includes(current?.status) || !!busy} onClick={() => act('repeat')}>🔁 {t('repeat')}</button>
          <button className="btn-ghost py-4" disabled={!current || !['called', 'waiting'].includes(current?.status) || !!busy}
            onClick={() => act('skip', current?.id)}>⏭ {t('skip')}</button>
          <button className="btn-ghost py-4" disabled={!current || current.status !== 'called' || !!busy} onClick={() => act('in_room', current?.id)}>🚪 {t('inRoom')}</button>
          <button className="btn-ghost py-4" disabled={(!inRoom.length && current?.status !== 'called') || !!busy} onClick={() => act('done')}>✅ {t('finish')}</button>
        </section>
        <section className="flex flex-wrap gap-2 text-sm">
          <button className="btn-ghost" onClick={async () => {
            setBusy('sync');
            const j: any = await doSync(true);
            await load();
            if (j?.requested) {
              // list comes from the clinic PC: it pushes within ~10 s of this request
              if (!j.owner) flash('لا يوجد جهاز عيادة يرسل القائمة اليوم – شغّل جهاز العيادة', 'err');
              else if ((j.seen_seconds_ago ?? 0) > 180) flash(`جهاز العيادة (${j.owner}) متوقف منذ ${Math.round(j.seen_seconds_ago / 60)} دقيقة`, 'err');
              else flash(`تم طلب التحديث من جهاز العيادة (${j.owner}) – خلال ثوانٍ`);
              [5000, 10000, 16000].forEach((ms) => setTimeout(load, ms));
            }
            setBusy(null);
          }} disabled={!!busy}>⟳ {t('refresh')}</button>
          <button className="btn-ghost" onClick={() => act(data.day?.paused ? 'resume' : 'pause')} disabled={!!busy}>{data.day?.paused ? `▶ ${t('resume')}` : `⏸ ${t('pause')}`}</button>
          <button className="btn-ghost" disabled={!data.last_action || !!busy} title={data.last_action ? ACTION_AR[data.last_action.action] : ''}
            onClick={() => setDialog({ type: 'confirm', text: `التراجع عن آخر إجراء: «${ACTION_AR[data.last_action.action]}» (${data.last_action.actor ?? ''})؟`, run: () => act('undo') })}>
            ↶ {t('undo')}{data.last_action ? <span className="text-xs text-slate-400">({ACTION_AR[data.last_action.action]})</span> : null}</button>
          <button className="btn-ghost" onClick={() => setDialog({ type: 'walkin' })}>＋ {t('walkin')}</button>
          <Link className="btn-ghost" href={`/summary/${clinic}`}>📋 {t('summary')}</Link>
          <span className="ms-auto self-center text-xs text-slate-400">
            {data.policy === 'time' ? 'ترتيب حسب الموعد' : data.policy === 'checkin' ? 'ترتيب حسب الوصول' : 'أرقام يدوية'}
          </span>
        </section>

        {/* list */}
        <section className="card overflow-visible">
          <div className="flex flex-wrap items-center gap-2 border-b border-slate-100 p-3">
            <input className="input max-w-sm" placeholder={t('search')} value={q} onChange={(e) => setQ(e.target.value)} />
            <div className="flex flex-wrap gap-1 text-xs">
              {(['active', 'waiting', 'called', 'in_room', 'absent', 'postponed', 'done', 'cancelled', 'all'] as const).map((f) => {
                const c = f === 'active' ? s.total - s.done - s.cancelled : f === 'all' ? s.total : s[f];
                return (
                  <button key={f} onClick={() => setFilter(f as any)}
                    className={`chip px-3 py-1.5 ${filter === f ? 'bg-ink-800 text-white' : 'bg-slate-100 text-slate-600'}`}>
                    {f === 'active' ? (ar ? 'الحاليون' : 'Active') : f === 'all' ? t('all') : SL[f as Status]} <span className="num opacity-70">{N(c)}</span>
                  </button>);
              })}
              {data.policy === 'checkin' && s.booked > 0 && <span className="chip bg-slate-100 text-slate-500">{SL.booked}: {N(s.booked)}</span>}
            </div>
          </div>

          <div className="divide-y divide-slate-100">
            {shown.length === 0 && <div className="p-8 text-center text-sm text-slate-400">{t('emptyQueue')}</div>}
            {shown.map((e) => (
              <Row key={e.id} e={e} N={N} ar={ar} lang={lang} SL={SL} isCurrent={e.id === current?.id} busy={busy} policy={data.policy}
                open={menu === e.id} setOpen={(o: boolean) => setMenu(o ? e.id : null)} act={act}
                askNumber={() => setDialog({ type: 'number', entry: e })}
                confirm={(text: string, run: () => void) => setDialog({ type: 'confirm', text, run })} />
            ))}
          </div>
        </section>
      </main>

      {toast && (
        <div className={`fixed inset-x-3 bottom-4 z-50 mx-auto flex max-w-lg items-center gap-3 rounded-2xl px-4 py-3 text-sm font-semibold shadow-xl ${toast.kind === 'ok' ? 'bg-ink-900 text-white' : 'bg-rose-600 text-white'}`}>
          <span className="flex-1">{toast.msg}</span>
          {toast.undo && <button className="rounded-lg bg-white/15 px-3 py-1" onClick={() => { setToast(null); act('undo'); }}>{t('undo')}</button>}
        </div>)}

      {dialog && <Dialog dialog={dialog} close={() => setDialog(null)} act={act} policy={data.policy} />}
    </div>
  );
}

function Row({ e, N, ar, lang, SL, isCurrent, busy, policy, open, setOpen, act, askNumber, confirm }: any) {
  const st = e.status as Status;
  const primary: [string, string, any?][] = [];
  if (st === 'booked') primary.push(['checkin', 'تسجيل وصول']);
  if (st === 'waiting') primary.push(['call', 'نداء']);
  if (st === 'called') primary.push(['in_room', 'دخول']);
  if (st === 'in_room') primary.push(['done', 'إنهاء']);
  if (st === 'absent' || st === 'postponed') primary.push(['return_waiting', 'إرجاع']);

  const more: [string, string, any?][] = [];
  if (['waiting'].includes(st)) more.push(['move', '⬆ تقديم', { dir: 'up' }], ['move', '⬇ تأخير', { dir: 'down' }]);
  if (['waiting', 'called', 'absent', 'postponed', 'booked', 'cancelled'].includes(st)) more.push(['emergency', '🚑 أولوية طارئة']);
  if (['called', 'absent', 'postponed'].includes(st)) more.push(['call', 'إعادة نداء هذا المريض']);
  if (['absent', 'postponed', 'called'].includes(st)) more.push(['return_waiting', 'إرجاع لمكانه في الدور', { position: 'original' }], ['return_waiting', 'إرجاع كالتالي مباشرة', { position: 'next' }]);
  if (st === 'cancelled') more.push(['return_waiting', 'استعادة إلى الانتظار']);
  if (['waiting', 'called'].includes(st)) more.push(['skip', 'غائب (تخطي)'], ['in_room', 'دخول الكشف']);
  if (['waiting', 'called', 'absent', 'booked'].includes(st)) more.push(['postpone', 'تأجيل']);
  if (['waiting', 'booked'].includes(st) || policy === 'manual') more.push(['__number', 'تعيين رقم الدور']);
  if (!['done', 'cancelled'].includes(st)) more.push(['cancel', 'إلغاء الحجز']);

  const run = ([a, , args]: [string, string, any?]) => {
    if (a === '__number') return askNumber();
    if (a === 'cancel') return confirm(`إلغاء دور ${e.patient_name}؟`, () => act('cancel', e.id));
    act(a, e.id, args ?? {});
  };

  return (
    <div className={`flex items-center gap-3 px-3 py-2.5 ${isCurrent ? 'bg-amber-50/70' : ''} ${st === 'cancelled' || st === 'done' ? 'opacity-60' : ''}`}>
      <div className={`num grid h-12 w-12 shrink-0 place-items-center rounded-xl text-xl font-extrabold ${isCurrent ? 'bg-gold-500 text-ink-950' : 'bg-slate-100 text-ink-800'}`}>{N(e.queue_number)}</div>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="truncate font-bold text-ink-900">{e.patient_name || '—'}</span>
          {e.priority && <span className="chip bg-rose-600 text-white">طارئ</span>}
          {e.source === 'walkin' && <span className="chip bg-teal-50 text-teal-700">بدون حجز</span>}
          {e.dup_hint && <span className="chip bg-amber-100 text-amber-800" title={`حجز آخر اليوم: ${e.dup_hint}`}>⚠ مكرر</span>}
        </div>
        <div className="mt-0.5 flex flex-wrap gap-x-3 text-xs text-slate-500">
          <span className="num">{fmtTime12(e.appt_time, lang)}</span>
          {e.procedure && <span>{e.procedure}</span>}
          {e.booking_id && <span className="num" dir="ltr">#{e.booking_id}</span>}
          {e.phone && <a className="num text-sky-700" dir="ltr" href={`https://wa.me/2${e.phone}`} target="_blank" rel="noreferrer">{e.phone}</a>}
          {e.est_wait_min !== null && <span className="text-violet-700">≈ {N(e.est_wait_min)} د ({ar ? 'تقديري' : 'est.'})</span>}
          {e.called_at && <span>نداء {fmtTs12(e.called_at, lang)}</span>}
        </div>
      </div>
      <span className={`chip hidden shrink-0 sm:inline-flex ${STATUS_STYLE[st]}`}>{SL[st]}</span>
      {primary.map((p) => (
        <button key={p[0]} className="btn-primary shrink-0 px-3 py-2 text-sm" disabled={!!busy} onClick={() => run(p)}>{p[1]}</button>))}
      <div className="relative shrink-0">
        <button className="btn-ghost px-3 py-2" onClick={() => setOpen(!open)} aria-label="more">⋯</button>
        {open && (<>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className="absolute end-0 z-50 mt-1 w-56 overflow-hidden rounded-xl bg-white py-1 shadow-xl ring-1 ring-slate-200">
            <div className={`px-3 py-1.5 text-[11px] sm:hidden ${STATUS_STYLE[st]}`}>{SL[st]}</div>
            {more.map((m, i) => (
              <button key={i} className="block w-full px-3 py-2 text-start text-sm hover:bg-slate-50 disabled:opacity-40" disabled={!!busy} onClick={() => run(m)}>{m[1]}</button>))}
          </div></>)}
      </div>
    </div>
  );
}

function Dialog({ dialog, close, act, policy }: any) {
  const [a, setA] = useState(''); const [b, setB] = useState(''); const [c, setC] = useState(''); const [n, setN] = useState('');
  return (
    <div className="fixed inset-0 z-[60] grid place-items-center bg-ink-950/50 p-4" onClick={close}>
      <div className="w-full max-w-md rounded-2xl bg-white p-5 shadow-2xl" onClick={(e) => e.stopPropagation()}>
        {dialog.type === 'confirm' && (<>
          <p className="mb-5 font-semibold text-ink-900">{dialog.text}</p>
          <div className="flex gap-2"><button className="btn-primary flex-1" onClick={() => { dialog.run(); close(); }}>تأكيد</button><button className="btn-ghost flex-1" onClick={close}>إلغاء</button></div>
        </>)}
        {dialog.type === 'walkin' && (
          <form onSubmit={(e) => { e.preventDefault(); act('add_walkin', null, { name: a, phone: b, procedure: c, number: n }); close(); }}>
            <h3 className="mb-4 font-display text-lg font-bold">إضافة مريض بدون حجز</h3>
            <label className="label">الاسم</label><input className="input mb-3" value={a} onChange={(e) => setA(e.target.value)} required autoFocus />
            <label className="label">رقم واتساب</label><input className="input mb-3" dir="ltr" inputMode="tel" value={b} onChange={(e) => setB(e.target.value)} />
            <label className="label">الإجراء</label><input className="input mb-3" value={c} onChange={(e) => setC(e.target.value)} placeholder="كشف / استشارة" />
            {policy === 'manual' && (<><label className="label">رقم الدور</label><input className="input mb-3" inputMode="numeric" value={n} onChange={(e) => setN(toWesternDigits(e.target.value))} /></>)}
            <div className="mt-2 flex gap-2"><button className="btn-primary flex-1">إضافة</button><button type="button" className="btn-ghost flex-1" onClick={close}>إلغاء</button></div>
          </form>)}
        {dialog.type === 'number' && (
          <form onSubmit={(e) => { e.preventDefault(); act('set_number', dialog.entry.id, { number: Number(toWesternDigits(n)) }); close(); }}>
            <h3 className="mb-1 font-display text-lg font-bold">تعيين رقم الدور</h3>
            <p className="mb-4 text-sm text-slate-500">{dialog.entry.patient_name}</p>
            <input className="input mb-4 text-center text-3xl font-bold num" inputMode="numeric" value={n} onChange={(e) => setN(e.target.value)} autoFocus required />
            <div className="flex gap-2"><button className="btn-primary flex-1">حفظ</button><button type="button" className="btn-ghost flex-1" onClick={close}>إلغاء</button></div>
          </form>)}
      </div>
    </div>
  );
}
