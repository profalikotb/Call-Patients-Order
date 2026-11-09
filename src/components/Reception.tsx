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
  const [wa, setWa] = useState<null | { phone: string; name: string }>(null);      // quick WhatsApp box
  // push mode: clinic PCs that send the list, and which PC THIS browser belongs to
  const [pcs, setPcs] = useState<{ owner: string | null; pinned: boolean; ownerAgo: number | null; sources: any[] } | null>(null);
  const [thisPc, setThisPc] = useState<string>('');
  useEffect(() => { try { setThisPc(localStorage.getItem('queue.thisPc') || ''); } catch {} }, []);
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

  // persistent clinic session (stays open after midnight until «إنهاء الجلسة»)
  const [sess, setSess] = useState<any>(undefined);
  const [newSess, setNewSess] = useState<string | null>(null);       // date picker value while starting a session
  const loadSess = useCallback(async () => {
    try { const j = await (await fetch('/api/session', { cache: 'no-store' })).json(); if (j.ok) setSess(j.session ?? null); } catch {}
  }, []);
  const sessionAct = useCallback(async (body: any, okMsg: string) => {
    setBusy('session');
    try {
      const j = await (await fetch('/api/session', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })).json();
      if (j.ok) flash(okMsg); else flash(String(j.detail || j.error || 'تعذّر'), 'err');
    } catch { flash('تعذر الاتصال بالخادم', 'err'); }
    setNewSess(null); await loadSess(); await doSync(true); await load(); setBusy(null);
    [5000, 10000, 16000].forEach((ms) => setTimeout(load, ms));
  }, [loadSess]);

  const loadPcs = useCallback(async () => {
    try {
      const j = await (await fetch('/api/sync', { cache: 'no-store' })).json();
      if (j.ok && j.source === 'push') setPcs({ owner: j.owner ?? null, pinned: !!j.pinned, ownerAgo: j.owner_seen_seconds_ago ?? null, sources: j.sources ?? [] });
    } catch {}
  }, []);

  const doSync = useCallback(async (force = false, pc?: string) => {
    try {
      const r = await fetch('/api/sync', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ force, pc }) });
      const j = await r.json();
      if (pc) return j;                                  // switching PC: caller shows the result
      if (!j.skipped && !j.requested) setSync({ ok: !!j.ok, at: Date.now(), error: j.error });
      return j;
    } catch (e: any) { setSync({ ok: false, at: Date.now(), error: String(e?.message || e) }); return null; }
  }, []);

  // initial + 10 s sheet sync loop (server throttles across devices)
  useEffect(() => {
    let alive = true;
    (async () => { await doSync(true); await load(); await loadPcs(); await loadSess(); })();
    const id = setInterval(async () => { if (!alive || document.hidden) return; await doSync(false); await load(); await loadPcs(); await loadSess(); }, 10000);
    return () => { alive = false; clearInterval(id); };
  }, [doSync, load, loadPcs, loadSess]);

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

  // finish the patient in the room / current call, then call the next one – one press
  const doneAndNext = useCallback(async () => {
    const cur = (data?.entries ?? []).find((e: any) => e.id === data?.day?.current_entry_id);
    const hasOpen = (data?.entries ?? []).some((e: any) => e.status === 'in_room') || cur?.status === 'called';
    if (hasOpen) await act('done');
    await act('call_next', null, {}, false);
  }, [act, data]);

  // keyboard (ignored while typing, except Enter in search):
  // F8 call next · F9 done + next · F7/F10 repeat · F6 patient entered · / search
  const searchRef = useRef<HTMLInputElement | null>(null);
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.tagName === 'INPUT') return;
      const cur = (data?.entries ?? []).find((x: any) => x.id === data?.day?.current_entry_id);
      if (e.key === 'F8') { e.preventDefault(); act('call_next', null, {}, true); }
      else if (e.key === 'F9') { e.preventDefault(); doneAndNext(); }
      else if (e.key === 'F7' || e.key === 'F10') { e.preventDefault(); act('repeat'); }
      else if (e.key === 'F6') { e.preventDefault(); if (cur?.status === 'called') act('in_room', cur.id); }
      else if (e.key === '/') { e.preventDefault(); searchRef.current?.focus(); }
    };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [act, doneAndNext, data]);

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
        (dq.length >= 1 && String(e.patient_code ?? '').startsWith(dq)) ||
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

      <main className="mx-auto max-w-[1600px] space-y-4 px-3 pt-4 sm:px-5">
        {/* current patient (number + code + name) · next three · live counters */}
        {(() => {
          const live = entries.filter((e) => e.status !== 'cancelled');
          const kind = (e: Entry, k: string) => normalizeAr(e.procedure ?? '').includes(normalizeAr(k));
          const doneN = live.filter((e) => e.status === 'done').length;
          const waitingN = live.filter((e) => e.status === 'waiting' || e.status === 'booked').length;
          const nextUp = entries.filter((e) => e.status === 'waiting').sort((a, b) => (a.queue_number ?? 1e9) - (b.queue_number ?? 1e9)).slice(0, 3);
          const cards: [string, number, string, string][] = [
            ['إجمالي المرضى', live.length, '👥', 'bg-blue-700'],
            ['كشف', live.filter((e) => kind(e, 'كشف')).length, '🩺', 'bg-teal-600'],
            ['استشارة', live.filter((e) => kind(e, 'استشارة')).length, '💬', 'bg-purple-600'],
            ['في الانتظار', waitingN, '⏳', 'bg-amber-500'],
            ['تم الكشف', doneN, '✔', 'bg-emerald-600'],
            ['المتبقون', live.length - doneN, '➜', 'bg-orange-500'],
          ];
          const curDone = current?.status === 'done';
          return (
            <section className={`grid gap-3 ${data.role === 'admin' ? 'lg:grid-cols-[1.25fr_2fr]' : ''}`}>
              <div className="card relative overflow-hidden bg-gradient-to-br from-ink-900 to-ink-700 p-4 text-white ring-0">
                <div className="flex items-center justify-between text-xs font-semibold text-gold-300">
                  <span>{curDone ? (ar ? 'آخر مريض (تم الكشف)' : 'Last patient (seen)') : t('current')}</span>
                  {current && <span className="text-white/60">{SL[current.status as Status]}{current.called_count > 1 ? ` · ×${N(current.called_count)}` : ''}</span>}
                </div>
                {current ? (
                  <div className="mt-1 flex items-center gap-4">
                    <div key={current.id} className={`num animate-pop font-black leading-none ${curDone ? 'text-white/40' : 'text-gold-400'} ${current.queue_number ? 'text-7xl sm:text-8xl' : 'text-4xl'}`}>
                      {current.queue_number ? N(current.queue_number) : '✓'}</div>
                    <div className="min-w-0">
                      {current.patient_code && <div className="num inline-block rounded-lg bg-blue-600 px-2.5 py-0.5 text-2xl font-black tracking-wide" dir="ltr">{N(current.patient_code)}</div>}
                      <div className="mt-1 truncate text-lg font-bold">{current.patient_name}</div>
                      {current.procedure && <div className="text-xs text-white/60">{current.procedure}</div>}
                    </div>
                  </div>) : <div className="mt-3 text-white/50">{t('noCurrent')}</div>}
                <div className="mt-3 border-t border-white/10 pt-2 text-xs">
                  <span className="text-white/50">{ar ? 'التالي:' : 'Next:'} </span>
                  {nextUp.length ? nextUp.map((e, i) => (
                    <span key={e.id} className={`me-3 ${i === 0 ? 'font-bold text-gold-300' : 'text-white/80'}`}>
                      <span className="num">{N(e.queue_number)}</span> {String(e.patient_name || '').split(' ').slice(0, 2).join(' ')}</span>))
                    : <span className="text-white/40">{ar ? 'لا يوجد منتظرون' : 'nobody waiting'}</span>}
                  {inRoom.length > 0 && <span className="ms-2 text-violet-200">· {t('inRoom')}: {inRoom.map((e) => N(e.queue_number ?? e.patient_code)).join('، ')}</span>}
                  {s.avg_consult_min > 0 && <span className="ms-2 text-white/40">· {t('avg')} ≈ {N(Math.round(s.avg_consult_min))} {t('min')}</span>}
                </div>
              </div>
              {data.role === 'admin' && <div className="grid grid-cols-3 gap-2">   {/* counters: doctor/admin only, hidden from reception staff */}
                {cards.map(([label, n, icon, bg]) => (
                  <div key={label} className={`${bg} flex flex-col justify-center rounded-xl px-3 py-2 text-white shadow-sm`}>
                    <div className="flex items-center justify-between text-xs font-semibold opacity-90"><span>{label}</span><span>{icon}</span></div>
                    <div className="num text-3xl font-black leading-tight">{N(n)}</div>
                  </div>))}
              </div>}
            </section>);
        })()}

        {/* primary controls */}
        <section className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-6">
          <button className="btn-gold py-5 text-lg" disabled={!canCall || !!busy}
            onClick={() => act('call_next', null, {}, true)}>📢 {t('callNext')} <kbd className="hidden rounded bg-ink-950/10 px-1.5 text-[10px] lg:inline">F8</kbd></button>
          <button className="rounded-2xl bg-emerald-600 py-5 text-lg font-bold text-white shadow-sm hover:bg-emerald-500 disabled:opacity-40" disabled={!canCall || !!busy}
            onClick={doneAndNext} title={ar ? 'إنهاء الكشف الحالي ثم نداء التالي' : 'Finish current, call next'}>
            ✅ {ar ? 'تم ونداء التالي' : 'Done + next'} <kbd className="hidden rounded bg-white/20 px-1.5 text-[10px] lg:inline">F9</kbd></button>
          <button className="btn-primary py-4" disabled={!current || !['called', 'in_room'].includes(current?.status) || !!busy} onClick={() => act('repeat')}>🔁 {t('repeat')} <kbd className="hidden rounded bg-white/20 px-1 text-[10px] lg:inline">F10</kbd></button>
          <button className="btn-ghost py-4" disabled={!current || !['called', 'waiting'].includes(current?.status) || !!busy}
            onClick={() => act('skip', current?.id)}>⏭ {t('skip')}</button>
          <button className="btn-ghost py-4" disabled={!current || current.status !== 'called' || !!busy} onClick={() => act('in_room', current?.id)}>🚪 {t('inRoom')} <kbd className="hidden rounded bg-slate-100 px-1 text-[10px] lg:inline">F6</kbd></button>
          <button className="btn-ghost py-4" disabled={(!inRoom.length && current?.status !== 'called') || !!busy} onClick={() => act('done')}>✅ {t('finish')}</button>
        </section>
        <section className="flex flex-wrap gap-2 text-sm">
          <button className="btn-ghost" onClick={async () => {
            setBusy('sync');
            // pressed on a PC that is set as «هذا الجهاز» → that PC sends the list; otherwise ask the sending PC
            const me = thisPc && pcs?.sources.find((x) => x.name === thisPc);
            const j: any = me && pcs?.owner !== thisPc ? await doSync(true, thisPc) : await doSync(true);
            await load();
            if (j?.requested) {
              const who = j.label || j.owner;
              if (!j.owner) flash('لا يوجد جهاز يرسل القائمة اليوم – شغّل جهاز العيادة', 'err');
              else if ((j.seen_seconds_ago ?? 0) > 180) flash(`${who} متوقف منذ ${Math.round(j.seen_seconds_ago / 60)} دقيقة – اختر جهازاً آخر`, 'err');
              else flash(`تم طلب التحديث من ${who} – خلال ثوانٍ`);
              [5000, 10000, 16000].forEach((ms) => setTimeout(load, ms));
              loadPcs();
            } else if (j && !j.ok && j.error) flash(String(j.detail || j.error), 'err');
            setBusy(null);
          }} disabled={!!busy}>⟳ {t('refresh')}{thisPc && pcs ? <span className="text-xs text-slate-400">({pcs.sources.find((x) => x.name === thisPc)?.label ?? thisPc})</span> : null}</button>
          <button className="btn-ghost" onClick={() => act(data.day?.paused ? 'resume' : 'pause')} disabled={!!busy}>{data.day?.paused ? `▶ ${t('resume')}` : `⏸ ${t('pause')}`}</button>
          <button className="btn-ghost" disabled={!data.last_action || !!busy} title={data.last_action ? ACTION_AR[data.last_action.action] : ''}
            onClick={() => setDialog({ type: 'confirm', text: `التراجع عن آخر إجراء: «${ACTION_AR[data.last_action.action]}» (${data.last_action.actor ?? ''})؟`, run: () => act('undo') })}>
            ↶ {t('undo')}{data.last_action ? <span className="text-xs text-slate-400">({ACTION_AR[data.last_action.action]})</span> : null}</button>
          <button className="btn-ghost" onClick={() => setDialog({ type: 'walkin' })}>＋ {t('walkin')}</button>
          <Link className="btn-ghost" href={`/summary/${clinic}`}>📋 {t('summary')}</Link>
          {BOOKING_PAGES[clinic] && <button className="btn-ghost" onClick={() => openBookingPage(BOOKING_PAGES[clinic])}
            title={ar ? 'يفتح جدول الحجز في نافذة على يسار الشاشة' : 'opens the booking page on the left'}>📅 {ar ? 'جدول الحجز' : 'Bookings'}</button>}
          <button className="btn-ghost" onClick={() => setWa({ phone: '', name: '' })} title={ar ? 'انسخ الرقم من جدول الحجز والصقه هنا' : 'paste a number'}>💬 {ar ? 'واتساب' : 'WhatsApp'}</button>
          <span className="ms-auto self-center text-xs text-slate-400">
            {data.policy === 'time' ? 'ترتيب حسب الموعد' : data.policy === 'checkin' ? 'ترتيب حسب الوصول' : 'أرقام يدوية'}
          </span>
        </section>

        {/* one slim line: session + list source (wraps on small screens) */}
        <div className="flex flex-wrap items-stretch gap-2">
        {/* clinic session: the list stays the same across midnight until the session is ended */}
        {sess !== undefined && (() => {
          const wd = (d: string) => new Intl.DateTimeFormat('ar-EG', { weekday: 'long', timeZone: 'UTC' }).format(new Date(d + 'T12:00:00Z'));
          const todayIso = new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Cairo' }).format(new Date());
          const sd = sess ? String(sess.date).slice(0, 10) : '';
          const other = sess && sess.clinic !== clinic;
          return (
            <section className={`flex min-w-0 flex-1 flex-wrap items-center gap-2 rounded-xl px-3 py-1.5 text-xs ring-1 ${!sess ? 'bg-slate-50 ring-slate-200' : other ? 'bg-amber-50 ring-amber-200' : 'bg-emerald-50 ring-emerald-200'}`}>
              {sess ? (<>
                <span className="font-bold text-emerald-800">● {ar ? 'الجلسة المفتوحة:' : 'Open session:'}</span>
                <span className="font-semibold">{sess.clinic_name ?? sess.clinic}</span>
                <span className="num">{wd(sd)} {fmtDate(sd, ar)}</span>
                <span className="text-slate-500">· {ar ? 'بدأت' : 'started'} {fmtTs12(sess.started_at, ar ? 'ar' : 'en')}{sess.auto ? (ar ? ' (تلقائياً)' : ' (auto)') : ''}</span>
                {sd < todayIso && <span className="rounded-full bg-indigo-600 px-2 py-0.5 font-semibold text-white">{ar ? 'مستمرة بعد منتصف الليل' : 'continues past midnight'}</span>}
                {other && <span className="font-semibold text-amber-800">{ar ? '– هذه الصفحة لعيادة أخرى' : '– this page is another clinic'}</span>}
              </>) : <span className="text-slate-500">{ar ? 'لا توجد جلسة مفتوحة – تبدأ تلقائياً مع أول قائمة' : 'No open session'}</span>}
              <span className="ms-auto flex flex-wrap items-center gap-1.5">
                {newSess !== null ? (<>
                  <input type="date" className="rounded-lg border border-slate-300 px-2 py-1" value={newSess} max={todayIso}
                    onChange={(e) => setNewSess(e.target.value)} />
                  <button className="btn-primary px-3 py-1 text-xs" disabled={!!busy || !newSess}
                    onClick={() => sessionAct({ action: 'start', clinic, date: newSess }, 'بدأت جلسة جديدة')}>{ar ? 'بدء الجلسة' : 'Start'}</button>
                  <button className="btn-ghost px-2 py-1 text-xs" onClick={() => setNewSess(null)}>{ar ? 'إلغاء' : 'Cancel'}</button>
                </>) : (<>
                  <button className="btn-ghost px-3 py-1 text-xs" disabled={!!busy} onClick={() => setNewSess(todayIso)}>＋ {ar ? 'جلسة جديدة' : 'New session'}</button>
                  {sess && <button className="btn-ghost px-3 py-1 text-xs text-rose-700" disabled={!!busy}
                    onClick={() => setDialog({ type: 'confirm', text: `إنهاء جلسة ${sess.clinic_name ?? ''} (${fmtDate(sd, true)})؟ المرضى يُحفظون في الأرشيف ولا يُحذفون.`,
                      run: () => sessionAct({ action: 'end' }, 'تم إنهاء الجلسة') })}>■ {ar ? 'إنهاء الجلسة' : 'End session'}</button>}
                </>)}
              </span>
            </section>);
        })()}

        {/* push mode: which PC sends today's list – tap to choose (stays all day), «تلقائي» = by priority, 📍 = this browser's PC */}
        {pcs && pcs.sources.length > 0 && (() => {
          const own = pcs.sources.find((x) => x.name === pcs.owner);
          const stale = own && (pcs.ownerAgo ?? 0) > 90;
          return (<>
          {own && (own.error || stale) && (
            <div className="basis-full rounded-xl bg-rose-50 px-3 py-2 text-xs text-rose-800 ring-1 ring-rose-200" dir="auto">
              ⚠ {own.label}: {own.error ? own.error : `لم يرسل القائمة منذ ${Math.round((pcs.ownerAgo ?? 0) / 60)} دقيقة`}
              {!own.online ? ' — الجهاز غير متصل' : ''}
            </div>)}
          <section className="flex flex-wrap items-center gap-1.5 rounded-xl bg-white px-2 py-1 text-xs ring-1 ring-slate-200">
            <span className="font-semibold text-slate-500">{ar ? 'المصدر:' : 'Source:'}</span>
            <button className={`rounded-full px-2.5 py-1 ring-1 ${!pcs.pinned ? 'bg-emerald-600 text-white ring-emerald-600' : 'bg-white text-slate-700 ring-slate-200'}`}
              disabled={!!busy || !pcs.pinned} title="الجهاز الأعلى أولوية المتصل يرسل القائمة"
              onClick={async () => {
                setBusy('pc');
                const j: any = await doSync(true, 'auto');
                if (j?.ok) { flash(`تلقائي حسب الأولوية – ${j.label ?? ''}`); [5000, 10000, 16000].forEach((ms) => setTimeout(load, ms)); }
                else flash(String(j?.error || j?.detail || 'تعذّر'), 'err');
                await loadPcs(); setBusy(null);
              }}>⚙ {ar ? 'تلقائي' : 'Auto'}</button>
            {pcs.sources.map((pc) => {
              const isOwner = pc.name === pcs.owner;
              return (
                <span key={pc.name} className={`inline-flex items-center overflow-hidden rounded-full ring-1 ${isOwner ? 'bg-emerald-600 text-white ring-emerald-600' : 'bg-white text-slate-700 ring-slate-200'}`}>
                  <button className="px-2.5 py-1 disabled:opacity-60" disabled={!!busy || isOwner}
                        title={pc.error || (pc.online ? '' : (ar ? 'غير متصل' : 'offline'))}
                    onClick={() => setDialog({ type: 'confirm', text: `تحويل قائمة اليوم إلى «${pc.label}»؟ يبقى هو المصدر طوال اليوم حتى تختار جهازاً آخر أو «تلقائي» (القائمة من قاعدة بيانات هذا الجهاز)`, run: async () => {
                      setBusy('pc');
                      const j: any = await doSync(true, pc.name);
                      if (j?.ok) { flash(`تم التحويل إلى ${pc.label} – القائمة خلال ثوانٍ`); [5000, 10000, 16000].forEach((ms) => setTimeout(load, ms)); }
                      else flash(String(j?.error || j?.detail || 'تعذّر التحويل'), 'err');
                      await loadPcs(); setBusy(null);
                    } })}>
                    <span className={pc.error ? 'text-rose-500' : pc.online ? 'text-emerald-400' : 'text-slate-400'}>●</span> {pc.label}
                    {isOwner ? (pcs.pinned ? (ar ? ' · مختار' : ' · chosen') : (ar ? ' · يرسل الآن' : ' · sending')) : ''}
                  </button>
                  <button className={`border-s px-1.5 py-1 ${isOwner ? 'border-white/30' : 'border-slate-200'} ${thisPc === pc.name ? '' : 'opacity-30'}`}
                    title={ar ? 'هذا الجهاز' : 'this PC'}
                    onClick={() => { const v = thisPc === pc.name ? '' : pc.name; setThisPc(v); try { v ? localStorage.setItem('queue.thisPc', v) : localStorage.removeItem('queue.thisPc'); } catch {} }}>📍</button>
                </span>);
            })}
          </section>
          </>);
        })()}

        </div>

        {/* list + (left side) today's online bookings, read-only guide */}
        <div className={`grid items-start gap-3 ${data.bookings?.length ? 'xl:grid-cols-[1fr_380px]' : ''}`}>
        <section className="card min-w-0 overflow-visible">
          <div className="flex flex-wrap items-center gap-2 border-b border-slate-100 p-3">
            <input ref={searchRef} className="input max-w-sm" value={q} onChange={(e) => setQ(e.target.value)}
              placeholder={ar ? 'بحث بالكود أو الاسم أو الرقم – Enter للنداء  ( / )' : t('search')}
              onKeyDown={(ev) => {
                if (ev.key === 'Escape') { setQ(''); (ev.target as HTMLInputElement).blur(); return; }
                if (ev.key !== 'Enter') return;
                const dq = toWesternDigits(q).replace(/\D/g, '');
                const exact = entries.filter((e) => (dq && (String(e.patient_code ?? '') === dq || String(e.queue_number ?? '') === dq)));
                const pool = (exact.length ? exact : shown).filter((e) => ['waiting', 'absent', 'postponed', 'booked', 'called'].includes(e.status));
                if (pool.length !== 1) { flash(pool.length ? (ar ? `${pool.length} نتائج – اكتب الكود كاملاً` : 'several matches') : (ar ? 'لا يوجد مريض بهذا الكود' : 'no match'), 'err'); return; }
                const e = pool[0];
                if (e.status === 'called') act('repeat'); else act('call', e.id);
                setQ('');
              }} />
            <div className="flex flex-wrap gap-1 text-xs">
              {(['active', 'waiting', 'called', 'in_room', 'absent', 'postponed', 'done', 'cancelled', 'all'] as const).map((f) => {
                const c = f === 'active' ? s.total - s.done - s.cancelled : f === 'all' ? s.total : s[f];
                return (
                  <button key={f} onClick={() => setFilter(f as any)}
                    className={`chip px-3 py-1.5 ${filter === f ? 'bg-ink-800 text-white' : 'bg-slate-100 text-slate-600'}`}>
                    {f === 'active' ? (ar ? 'الحاليون' : 'Active') : f === 'all' ? t('all') : SL[f as Status]}{data.role === 'admin' && <span className="num opacity-70"> {N(c)}</span>}
                  </button>);
              })}
              {data.role === 'admin' && data.policy === 'checkin' && s.booked > 0 && <span className="chip bg-slate-100 text-slate-500">{SL.booked}: {N(s.booked)}</span>}
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
          {data.bookings?.length > 0 && <BookingsGuide list={data.bookings} ar={ar} />}
        </div>
      </main>

      {toast && (
        <div className={`fixed inset-x-3 bottom-4 z-50 mx-auto flex max-w-lg items-center gap-3 rounded-2xl px-4 py-3 text-sm font-semibold shadow-xl ${toast.kind === 'ok' ? 'bg-ink-900 text-white' : 'bg-rose-600 text-white'}`}>
          <span className="flex-1">{toast.msg}</span>
          {toast.undo && <button className="rounded-lg bg-white/15 px-3 py-1" onClick={() => { setToast(null); act('undo'); }}>{t('undo')}</button>}
        </div>)}

      {dialog && <Dialog dialog={dialog} close={() => setDialog(null)} act={act} policy={data.policy} />}
      <DoctorMessages clinic={clinic} msgs={data.messages ?? []} reload={load} />
      {wa && <WhatsAppBox init={wa} clinicName={data.clinic.name_ar} room={data.room_label} close={() => setWa(null)} />}
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
    <div className={`flex items-center gap-3 border-s-4 px-3 py-2.5 ${
      isCurrent && st !== 'done' ? 'border-emerald-500 bg-emerald-50' :
      e.priority ? 'border-rose-500 bg-rose-50/40' :
      st === 'waiting' ? 'border-sky-400' : st === 'called' ? 'border-amber-400 bg-amber-50/50' : st === 'in_room' ? 'border-violet-500 bg-violet-50/50' :
      st === 'absent' || st === 'postponed' ? 'border-rose-300' : 'border-transparent'} ${st === 'cancelled' || st === 'done' ? 'bg-slate-50 opacity-55' : ''}`}>
      <div className={`num grid h-12 w-12 shrink-0 place-items-center rounded-xl text-xl font-extrabold ${isCurrent ? 'bg-gold-500 text-ink-950' : 'bg-slate-100 text-ink-800'}`}>{N(e.queue_number)}</div>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-1.5">
          {e.patient_code && <span className="num rounded-lg bg-blue-700 px-2 py-0.5 text-lg font-black leading-tight tracking-wide text-white" dir="ltr" title={ar ? "كود المريض" : "Patient code"}>{N(e.patient_code)}</span>}
          <span className="truncate font-bold text-ink-900">{e.patient_name || '—'}</span>
          {e.priority && <span className="chip bg-rose-600 text-white">طارئ</span>}
          {e.source === 'walkin' && <span className="chip bg-teal-50 text-teal-700">بدون حجز</span>}
          {e.dup_hint && <span className="chip bg-amber-100 text-amber-800" title={`حجز آخر اليوم: ${e.dup_hint}`}>⚠ مكرر</span>}
        </div>
        <div className="mt-0.5 flex flex-wrap gap-x-3 text-xs text-slate-500">
          <span className="num">{fmtTime12(e.appt_time, lang)}</span>
          {e.procedure && <span>{e.procedure}</span>}
          {!e.patient_code && e.booking_id && <span className="num" dir="ltr">#{e.booking_id}</span>}
          {e.booked_time && <span className="font-semibold text-indigo-700" title={ar ? 'موعد الحجز الإلكتروني' : 'online booking time'}>🕐 {e.booked_time}</span>}
          {e.wa_phone
            ? <a className="num font-semibold text-emerald-700" dir="ltr" href={`https://wa.me/${e.wa_phone}`} target="_blank" rel="noreferrer" title={ar ? 'واتساب من الحجز الإلكتروني' : 'WhatsApp from online booking'}>🟢 {e.wa_phone.replace(/^20/, '0')}</a>
            : e.phone && <a className="num text-sky-700" dir="ltr" href={`https://wa.me/2${e.phone}`} target="_blank" rel="noreferrer">{e.phone}</a>}
          {st === 'waiting' && (() => { const m = Math.max(0, Math.round((Date.now() - new Date(e.checked_in_at ?? e.created_at).getTime()) / 60000));
            return m > 0 ? <span className={m >= 60 ? 'font-semibold text-rose-600' : 'text-slate-500'}>⏱ {ar ? 'ينتظر' : 'waiting'} {N(m)} د</span> : null; })()}
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

// Read-only guide: today's online bookings (AllEvents2025). ✓ = same patient code is already in Oracle's list.
function BookingsGuide({ list, ar }: { list: any[]; ar: boolean }) {
  const [open, setOpen] = useState(true);
  const notIn = list.filter((b) => !b.in_list).length;
  return (
    <aside className="card sticky top-20 overflow-hidden xl:max-h-[calc(100dvh-6rem)] xl:overflow-y-auto">
      <button onClick={() => setOpen(!open)} className="flex w-full items-center justify-between bg-[#0b3f7a] px-3 py-2 text-sm font-bold text-white">
        <span>📅 {ar ? 'الحجز الإلكتروني' : 'Online bookings'} <span className="num font-normal opacity-80">({list.length})</span></span>
        <span className="text-xs font-normal opacity-80">{notIn ? `${notIn} ${ar ? 'غير مسجل في أوراكل' : 'not in Oracle'}` : ''} {open ? '▾' : '▸'}</span>
      </button>
      {open && (
        <table className="w-full text-xs">
          <thead className="bg-slate-100 text-slate-600">
            <tr><th className="px-2 py-1.5 text-start">{ar ? 'الوقت' : 'Time'}</th><th className="px-2 py-1.5 text-start">{ar ? 'الاسم' : 'Name'}</th>
              <th className="px-2 py-1.5 text-start">{ar ? 'التليفون' : 'Phone'}</th><th className="px-1 py-1.5"></th></tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {list.map((b, i) => {
              const kashf = /كشف/.test(b.procedure);
              return (
                <tr key={i} className={b.in_list ? 'bg-white' : kashf ? 'bg-[#5b3f37]/10' : 'bg-amber-50'}>
                  <td className="whitespace-nowrap px-2 py-1.5 font-semibold" dir="ltr">{String(b.time).replace(/:00(?=\s*[ap]m)/i, '').toUpperCase()}</td>
                  <td className="px-2 py-1.5">
                    <div className="font-semibold leading-tight">{b.name}</div>
                    <div className="text-[10px] text-slate-500">{b.procedure}{/^\d+$/.test(b.code) ? <span className="num" dir="ltr"> · {b.code}</span> : b.code ? ` · ${b.code}` : ''}</div>
                  </td>
                  <td className="whitespace-nowrap px-2 py-1.5">{b.phone
                    ? <a className="num text-emerald-700" dir="ltr" href={`https://wa.me/${b.phone}`} target="_blank" rel="noreferrer">{b.phone.replace(/^20/, '0')}</a>
                    : <span className="text-slate-300">—</span>}</td>
                  <td className="px-1 text-center" title={b.in_list ? (ar ? 'موجود في قائمة أوراكل' : 'in Oracle list') : (ar ? 'غير موجود في قائمة أوراكل' : 'not in Oracle list')}>
                    {b.in_list ? <span className="text-emerald-600">✓</span> : <span className="text-amber-600">●</span>}</td>
                </tr>);
            })}
          </tbody>
        </table>)}
    </aside>
  );
}

// Your existing online-booking pages, shown read-only beside the list (no extra script needed)
const BOOKING_PAGES: Record<string, string> = {
  heliopolis: 'https://script.google.com/macros/s/AKfycbyQJc5z3lW2PHEnX-3TMMQTYJQ2_2JM5vLaePhZfNTIJz8CpBKaoph84q0R4rtyWtc/exec',  // Sat / Sun / Tue
  toukh: 'https://script.google.com/macros/s/AKfycbyiLRlx9aNNEcOxV3PtBz-JqRS23g-HC9hjN1Zu034-EAiqC6cW9MkSdFI3vjwpZHg/exec',       // Friday
};

// opens the booking page as a narrow window docked on the LEFT of the screen (Google does not allow embedding it)
function openBookingPage(url: string) {
  const w = Math.min(900, Math.round(screen.availWidth * 0.5)), h = screen.availHeight;   // wide enough for the phone column
  const win = window.open(url, 'pq_bookings', `popup=yes,left=0,top=0,width=${w},height=${h}`);
  win?.focus();
}

// Quick WhatsApp: paste/type any number (01…, 201…, +20 1…) → choose a ready message → opens WhatsApp
const WA_TEMPLATES: [string, (n: string, c: string, r: string) => string][] = [
  ['تذكير بالموعد', (n, c) => `السلام عليكم ${n}\nنذكّركم بموعدكم اليوم في ${c} – عيادة أ.د. على قطب.\nبرجاء الحضور قبل الموعد بـ ١٥ دقيقة.`],
  ['اقترب دورك', (n, c, r) => `السلام عليكم ${n}\nاقترب دوركم الآن في ${c}، برجاء التواجد بالقرب من ${r}.`],
  ['دورك الآن', (n, c, r) => `السلام عليكم ${n}\nدوركم الآن – برجاء التوجه إلى ${r} فوراً.`],
  ['تأخير الطبيب', (n, c) => `السلام عليكم ${n}\nنعتذر، سيتأخر بدء الكشف اليوم في ${c} قليلاً. سنبلغكم عند اقتراب دوركم.`],
  ['تأكيد الحجز', (n, c) => `السلام عليكم ${n}\nتم تأكيد حجزكم في ${c} – عيادة أ.د. على قطب.`],
  ['فاتك دورك', (n) => `السلام عليكم ${n}\nتم نداء رقمكم ولم تكونوا موجودين. برجاء التوجه للاستقبال فور وصولكم وسيتم إدخالكم بعد المريض الحالي.`],
  ['موقع العيادة', (n, c) => `السلام عليكم ${n}\nموقع ${c} – عيادة أ.د. على قطب:\n${MAPS[c] ?? MAPS['عيادة مصر الجديدة']}`],
  ['إحضار الأشعة', (n) => `السلام عليكم ${n}\nبرجاء إحضار جميع الأشعات (الرنين / المقطعية) والتقارير والتحاليل السابقة معكم في موعد الكشف.`],
  ['تأجيل الموعد', (n) => `السلام عليكم ${n}\nنعتذر، تم تأجيل موعدكم. برجاء الرد على هذه الرسالة لاختيار موعد جديد مناسب لكم.`],
  ['إلغاء العيادة', (n) => `السلام عليكم ${n}\nنعتذر لظرف طارئ، تم إلغاء عيادة اليوم. سيتم التواصل معكم لتحديد موعد بديل.`],
  ['رسالة فارغة', () => ''],
];
const MAPS: Record<string, string> = {
  'عيادة مصر الجديدة': 'https://maps.app.goo.gl/kneM2xHcoW8rMNJ5A',
  'مصر الجديدة': 'https://maps.app.goo.gl/kneM2xHcoW8rMNJ5A',
  'عيادة طوخ': 'https://maps.app.goo.gl/UGxQ1xMsdCmEj2oS7',
  'طوخ': 'https://maps.app.goo.gl/UGxQ1xMsdCmEj2oS7',
  'وادي النيل': 'https://maps.app.goo.gl/HtfDCkk2QfTLGgNU7',
};
function waNumber(raw: string): string {
  let d = toWesternDigits(raw).replace(/\D/g, '');
  if (/^01\d{9}$/.test(d)) d = '2' + d;
  if (/^1\d{9}$/.test(d)) d = '20' + d;
  return /^201\d{9}$/.test(d) ? d : '';
}
function WhatsAppBox({ init, clinicName, room, close }: { init: { phone: string; name: string }; clinicName: string; room: string; close: () => void }) {
  const [phone, setPhone] = useState(init.phone);
  const [name, setName] = useState(init.name);
  const [ti, setTi] = useState(0);
  const [text, setText] = useState('');
  useEffect(() => { setText(WA_TEMPLATES[ti][1](name ? `أ/ ${name}` : '', clinicName, room)); }, [ti, name, clinicName, room]);
  useEffect(() => {                       // paste from clipboard automatically if it holds a phone number
    if (init.phone) return;
    navigator.clipboard?.readText?.().then((t) => { if (waNumber(t)) setPhone(t.trim()); }).catch(() => {});
  }, [init.phone]);
  const num = waNumber(phone);
  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-ink-950/50 p-3" onClick={close}>
      <div className="card w-full max-w-md space-y-3 p-5" onClick={(e) => e.stopPropagation()} dir="rtl">
        <h3 className="font-bold">💬 إرسال واتساب</h3>
        <input className="input num" dir="ltr" autoFocus placeholder="01xxxxxxxxx  أو  201xxxxxxxxx" value={phone} onChange={(e) => setPhone(e.target.value)} />
        <div className={`text-xs ${num ? 'text-emerald-700' : 'text-rose-600'}`}>{num ? `✓ ${num}` : 'الصق الرقم من جدول الحجز (Ctrl+V)'}</div>
        <input className="input" placeholder="اسم المريض (اختياري)" value={name} onChange={(e) => setName(e.target.value)} />
        <div className="flex flex-wrap gap-1.5">
          {WA_TEMPLATES.map(([l], i) => (
            <button key={l} onClick={() => setTi(i)} className={`chip px-3 py-1 ${ti === i ? 'bg-emerald-600 text-white' : 'bg-slate-100 text-slate-700'}`}>{l}</button>))}
        </div>
        <textarea className="input min-h-[110px]" value={text} onChange={(e) => setText(e.target.value)} />
        <div className="flex gap-2">
          <a className={`btn-primary flex-1 text-center ${num ? '' : 'pointer-events-none opacity-40'}`} target="_blank" rel="noreferrer"
            href={num ? `https://wa.me/${num}${text ? `?text=${encodeURIComponent(text)}` : ''}` : undefined} onClick={() => setTimeout(close, 300)}>فتح واتساب</a>
          <button className="btn-ghost" onClick={close}>إغلاق</button>
        </div>
      </div>
    </div>
  );
}

// Doctor → assistant messages: loud banner + repeating chime until «تم ✓»
function DoctorMessages({ clinic, msgs, reload }: { clinic: string; msgs: any[]; reload: () => void }) {
  const ctx = useRef<AudioContext | null>(null);
  useEffect(() => {                                   // the browser allows sound after the first click on the page
    const unlock = () => { try { ctx.current ??= new AudioContext(); ctx.current.resume(); } catch {} };
    window.addEventListener('pointerdown', unlock); return () => window.removeEventListener('pointerdown', unlock);
  }, []);
  useEffect(() => {
    if (!msgs.length) return;
    const ding = () => {
      const c = ctx.current; if (!c) return;
      [880, 660, 880].forEach((f, i) => {
        const o = c.createOscillator(), g = c.createGain(), t = c.currentTime + i * 0.22;
        o.frequency.value = f; g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.4, t + 0.02);
        g.gain.exponentialRampToValueAtTime(0.0001, t + 0.2); o.connect(g).connect(c.destination); o.start(t); o.stop(t + 0.22);
      });
    };
    ding(); const id = setInterval(ding, 4000);
    try { if (document.hidden && 'Notification' in window && Notification.permission === 'granted') new Notification('رسالة من الطبيب', { body: msgs[0].body }); } catch {}
    return () => clearInterval(id);
  }, [msgs.length, msgs]);
  useEffect(() => { try { if ('Notification' in window && Notification.permission === 'default') Notification.requestPermission(); } catch {} }, []);
  // voice notes play by themselves once (after the chime); ▶ plays again
  const played = useRef<Set<number>>(new Set());
  const play = (m: any) => { try { new Audio(`/api/staff-msg/voice?clinic=${clinic}&id=${m.id}`).play().catch(() => {}); } catch {} };
  useEffect(() => {
    for (const m of msgs) if (m.audio_path && !played.current.has(m.id)) { played.current.add(m.id); setTimeout(() => play(m), 900); }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [msgs]);
  if (!msgs.length) return null;
  const ack = async (id: number) => {
    await fetch('/api/staff-msg', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ clinic, ack: id }) }).catch(() => {});
    reload();
  };
  const time = (t: string) => new Intl.DateTimeFormat('ar-EG', { timeZone: 'Africa/Cairo', hour: 'numeric', minute: '2-digit' }).format(new Date(t));
  return (
    <div className="fixed inset-x-0 top-0 z-[60] space-y-1 p-2">
      {msgs.slice(0, 3).map((m) => (
        <div key={m.id} className="mx-auto flex max-w-3xl animate-pulse items-center gap-3 rounded-2xl bg-rose-600 px-5 py-4 text-white shadow-2xl ring-4 ring-rose-300">
          <span className="text-3xl">🔔</span>
          <div className="flex-1">
            <div className="text-xl font-black">{m.body}</div>
            <div className="text-xs opacity-80">{m.from_label ?? 'الطبيب'} · {time(m.created_at)}</div>
          </div>
          {m.audio_path && <button onClick={() => play(m)} className="rounded-xl bg-white/20 px-4 py-2 text-lg font-black">▶</button>}
          <button onClick={() => ack(m.id)} className="rounded-xl bg-white px-5 py-2 text-lg font-black text-rose-700">تم ✓</button>
        </div>))}
    </div>
  );
}
